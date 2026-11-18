/* Portal TACS — modo offline: service worker, sessão local e fila de envio.
   Os registros feitos sem internet ficam neste aparelho (localStorage) e sobem sozinhos
   quando a conexão volta. */
(function(){
  'use strict';

  /* ---------- Service worker ---------- */
  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('sw.js').catch(function(){ /* sem SW o site funciona online */ });
    });
  }

  /* ---------- Botão "Instalar app" ---------- */
  var promptInstalar = null;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault(); promptInstalar = e; atualizarBanner();
  });
  window.addEventListener('appinstalled', function(){ promptInstalar = null; atualizarBanner(); });

  /* ---------- Estado ---------- */
  var sb = null, sincronizando = false, ultimaMsg = '';
  var T = window.TACS = { aoSincronizar: null, url: '' };

  function chaveSessao(){
    var m = /^https?:\/\/([^.]+)\./.exec(T.url || '');
    return m ? 'sb-' + m[1] + '-auth-token' : null;
  }
  // Sessão guardada pelo Supabase; vale mesmo com o token vencido (sem internet não dá para renovar).
  T.sessaoLocal = function(){
    try{
      var k = chaveSessao(); if(!k) return null;
      var s = JSON.parse(localStorage.getItem(k) || 'null');
      return (s && s.user && s.user.id) ? s : null;
    }catch(e){ return null; }
  };
  function uid(){ var s = T.sessaoLocal(); return s ? s.user.id : null; }

  /* ---------- Fila ---------- */
  function chaveFila(){ var u = uid(); return u ? 'tacs_fila_' + u : null; }
  function lerFila(){
    try{ var k = chaveFila(); return k ? JSON.parse(localStorage.getItem(k) || '[]') : []; }
    catch(e){ return []; }
  }
  function gravarFila(f){
    var k = chaveFila(); if(!k) return false;
    try{ localStorage.setItem(k, JSON.stringify(f)); return true; }catch(e){ return false; }
  }
  T.pendentes = function(tipo){ return lerFila().filter(function(i){ return i.tipo === tipo; }); };
  T.descartar = function(tipo, id){
    gravarFila(lerFila().filter(function(i){ return !(i.tipo === tipo && i.id === id); }));
    atualizarBanner();
  };
  function enfileirar(tipo, id, payload){
    var f = lerFila().filter(function(i){ return !(i.tipo === tipo && i.id === id); });
    f.push({tipo: tipo, id: id, payload: payload, ts: new Date().toISOString()});
    return gravarFila(f);
  }

  T.novoId = function(){
    if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  };

  T.ehErroRede = function(err){
    if(!navigator.onLine) return true;
    if(!err) return false;
    var m = String(err.message || err);
    return !err.code && /fetch|network|load failed|timeout|abort/i.test(m);
  };

  /* ---------- Envio ao Supabase (idempotente: pode repetir sem duplicar) ---------- */
  var ENVIAR = {
    risco: async function(p){
      var q = await sb.from('planilhas_risco').upsert(Object.assign({id: p.id}, p.cab)).select('id').single();
      if(q.error) return q.error;
      var del = await sb.from('familias_risco').delete().eq('planilha_id', p.id);
      if(del.error) return del.error;
      if(p.rows.length){
        var ins = await sb.from('familias_risco').insert(p.rows.map(function(r){ return Object.assign({planilha_id: p.id}, r); }));
        if(ins.error) return ins.error;
      }
      return null;
    },
    paliativo: async function(p){
      var q = await sb.from('elegibilidade_paliativa').upsert(Object.assign({id: p.id}, p.linha)).select('id').single();
      return q.error || null;
    }
  };

  // Salva online; sem conexão, guarda no aparelho. Retorna {status:'ok'|'fila'|'erro', erro}
  T.salvar = async function(tipo, id, payload){
    payload.id = id;
    if(navigator.onLine && sb){
      var err;
      try{ err = await ENVIAR[tipo](payload); }catch(e){ err = e; }
      if(!err){ T.descartar(tipo, id); return {status: 'ok'}; }
      if(!T.ehErroRede(err)) return {status: 'erro', erro: err};
    }
    if(!enfileirar(tipo, id, payload)) return {status: 'erro', erro: {message: 'não foi possível guardar neste aparelho (armazenamento cheio?)'}};
    atualizarBanner();
    return {status: 'fila'};
  };

  T.sincronizar = async function(forcar){
    if(sincronizando || !sb || !navigator.onLine || !chaveFila()) return;
    sincronizando = true; ultimaMsg = '';
    var enviados = 0;
    try{
      var fila = lerFila();
      for(var i = 0; i < fila.length; i++){
        var it = fila[i];
        if(it.erro && !forcar) continue;
        var err;
        try{ err = await ENVIAR[it.tipo](it.payload); }catch(e){ err = e; }
        if(!err){ T.descartar(it.tipo, it.id); enviados++; continue; }
        if(T.ehErroRede(err)) break;                     // caiu a conexão: tenta de novo depois
        var f = lerFila();
        f.forEach(function(x){ if(x.tipo === it.tipo && x.id === it.id) x.erro = (err.code === '42501') ? 'assinatura vencida ou sem permissão para salvar' : String(err.message || err); });
        gravarFila(f);
      }
    } finally { sincronizando = false; }
    if(enviados) ultimaMsg = enviados + (enviados === 1 ? ' registro enviado' : ' registros enviados') + ' com sucesso.';
    atualizarBanner();
    if(enviados && typeof T.aoSincronizar === 'function'){ try{ T.aoSincronizar(); }catch(e){} }
  };

  T.iniciar = function(cliente){
    sb = cliente;
    atualizarBanner();
    window.addEventListener('online', function(){ atualizarBanner(); T.sincronizar(); });
    window.addEventListener('offline', atualizarBanner);
    T.sincronizar();
  };

  /* ---------- Banner ---------- */
  var barra = null;
  function criarBarra(){
    if(barra) return barra;
    var css = document.createElement('style');
    css.textContent =
      '#tacs-banner{position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;' +
      'padding:10px 16px;font:500 .9rem/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;background:#2f4f4a;' +
      'box-shadow:0 -2px 10px rgba(0,0,0,.18)}' +
      '#tacs-banner[hidden]{display:none}#tacs-banner.off{background:#8a5a00}#tacs-banner.erro{background:#9b2335}#tacs-banner.ok{background:#2e7d32}' +
      '#tacs-banner span{flex:1 1 220px}' +
      '#tacs-banner button{font:inherit;cursor:pointer;border:1px solid rgba(255,255,255,.7);background:transparent;color:#fff;border-radius:8px;padding:5px 12px}' +
      '@media print{#tacs-banner{display:none!important}}';
    document.head.appendChild(css);
    barra = document.createElement('div');
    barra.id = 'tacs-banner'; barra.setAttribute('role', 'status'); barra.hidden = true;
    document.body.appendChild(barra);
    return barra;
  }
  function botao(texto, fn){
    var b = document.createElement('button'); b.type = 'button'; b.textContent = texto; b.onclick = fn; return b;
  }
  function atualizarBanner(){
    if(!document.body){ document.addEventListener('DOMContentLoaded', atualizarBanner); return; }
    var b = criarBarra();
    var fila = lerFila(), erros = fila.filter(function(i){ return i.erro; });
    var offline = !navigator.onLine, cls = '', txt = '', acao = null;

    if(offline){
      cls = 'off';
      txt = 'Sem internet. Você pode continuar registrando: os dados ficam neste aparelho e sobem sozinhos quando a conexão voltar.' +
            (fila.length ? ' Aguardando envio: ' + fila.length + '.' : '');
    } else if(erros.length){
      cls = 'erro';
      txt = erros.length + ' registro(s) não foram aceitos pelo servidor: ' + erros[0].erro;
      acao = botao('Tentar de novo', function(){ T.sincronizar(true); });
    } else if(fila.length){
      cls = 'off';
      txt = fila.length + (fila.length === 1 ? ' registro aguardando envio.' : ' registros aguardando envio.');
      acao = botao('Enviar agora', function(){ T.sincronizar(true); });
    } else if(ultimaMsg){
      cls = 'ok'; txt = ultimaMsg;
    } else if(promptInstalar){
      cls = ''; txt = 'Instale o Portal TACS neste aparelho para abrir como aplicativo.';
      acao = botao('Instalar', function(){ promptInstalar.prompt(); promptInstalar = null; atualizarBanner(); });
    }

    b.className = cls; b.textContent = '';
    if(!txt){ b.hidden = true; document.body.style.paddingBottom = ''; return; }
    var s = document.createElement('span'); s.textContent = txt; b.appendChild(s);
    if(acao) b.appendChild(acao);
    b.hidden = false;
    document.body.style.paddingBottom = (b.offsetHeight + 8) + 'px';
    if(cls === 'ok') setTimeout(function(){ if(ultimaMsg){ ultimaMsg = ''; atualizarBanner(); } }, 5000);
  }
  window.addEventListener('online', atualizarBanner);
  window.addEventListener('offline', atualizarBanner);
  if(document.readyState !== 'loading') atualizarBanner();
  else document.addEventListener('DOMContentLoaded', atualizarBanner);
})();
