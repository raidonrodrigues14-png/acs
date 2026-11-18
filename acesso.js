/* Portal TACS — acesso por UBS e assinatura.
   Lê o perfil do usuário (UBS, papel, vencimento), guarda uma cópia no aparelho para o modo offline
   e mostra a tela de bloqueio com o Pix quando a assinatura vence.
   Atenção: a trava de verdade fica no banco (escala.sql). Esta tela é só a parte visível. */
(function(){
  'use strict';

  /* ======== CONFIGURE AQUI ======== */
  var CFG = {
    PIX_IMG: 'pix.png',          // imagem do QR Code do Pix (arquivo na mesma pasta)
    PIX_COPIA_COLA: '',          // opcional: texto do Pix "copia e cola"
    VALOR: '',                   // opcional: ex. 'R$ 49,90 por mês'
    WHATSAPP: ''                 // opcional: só números com DDI e DDD, ex. '5598999999999'
  };
  /* ================================ */

  var A = window.ACESSO = { perfil: null, estado: null, config: CFG };

  function hojeLocal(){ return new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'}); }
  function dataBR(iso){ if(!iso) return ''; var p = String(iso).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function chave(uid){ return 'tacs_acesso_' + uid; }
  function lerCache(uid){ try{ return JSON.parse(localStorage.getItem(chave(uid)) || 'null'); }catch(e){ return null; } }
  function gravarCache(uid, p){ try{ localStorage.setItem(chave(uid), JSON.stringify(p)); }catch(e){} }
  function limparCache(uid){ try{ localStorage.removeItem(chave(uid)); }catch(e){} }

  function calcularEstado(p, hoje){
    if(!p) return null;
    if(!p.ativo) return 'desativado';
    if(p.ubs_ativa === false) return 'ubs_inativa';
    if(p.papel !== 'admin' && (!p.vencimento || p.vencimento < hoje)) return 'vencido';
    return 'ok';
  }

  // Descobre o estado do acesso. Online pergunta ao banco; sem internet usa a cópia guardada.
  A.avaliar = async function(sb, sessao){
    var uid = sessao.user.id, perfil = null, hoje = hojeLocal(), semPerfil = false;
    if(navigator.onLine){
      try{
        var r = await sb.rpc('meu_acesso');
        if(!r.error){
          perfil = (r.data && r.data[0]) || null;
          if(perfil){ hoje = perfil.hoje || hoje; gravarCache(uid, perfil); }
          else { semPerfil = true; limparCache(uid); }
        }
      }catch(e){ /* cai no cache */ }
    }
    if(!perfil && !semPerfil) perfil = lerCache(uid);
    var estado = perfil ? calcularEstado(perfil, hoje) : (semPerfil ? 'sem_perfil' : 'sem_cache');
    A.perfil = perfil; A.estado = estado;
    return {estado: estado, perfil: perfil};
  };

  // Para as páginas internas: se não pode entrar, volta para a tela inicial (onde aparece o aviso/Pix).
  A.exigir = async function(sb, sessao, papeis){
    var a = await A.avaliar(sb, sessao);
    var ok = a.estado === 'ok' && (!papeis || papeis.indexOf(a.perfil.papel) >= 0);
    if(!ok) location.replace('./');
    return ok;
  };

  A.rotulo = function(sessao){
    var p = A.perfil;
    return sessao.user.email + (p && p.ubs_nome ? ' · ' + p.ubs_nome : (p && p.papel === 'admin' ? ' · Administração' : ''));
  };

  /* ---------- Tela de bloqueio ---------- */
  var cssPronto = false;
  function css(){
    if(cssPronto) return; cssPronto = true;
    var s = document.createElement('style');
    s.textContent =
      '.bloq{max-width:460px;margin:8vh auto 0;background:#fff;border:1px solid #d3e2de;border-radius:18px;padding:28px 26px;text-align:center;color:#17302b;font-family:inherit}' +
      '.bloq h2{margin:0 0 8px;font-size:1.3rem;font-weight:600}' +
      '.bloq p{margin:8px 0;color:#4d625b;line-height:1.55;font-size:.95rem}' +
      '.bloq img.qr{display:block;margin:16px auto 6px;width:min(260px,70vw);height:auto;border:1px solid #d3e2de;border-radius:12px;padding:8px;background:#fff}' +
      '.bloq .valor{font-weight:600;font-size:1.05rem;margin:4px 0 10px}' +
      '.bloq .acoes{display:flex;flex-direction:column;gap:10px;margin-top:16px}' +
      '.bloq button,.bloq a.bt{font:inherit;font-weight:500;cursor:pointer;text-decoration:none;display:block;padding:12px 16px;border-radius:10px;border:1px solid #0f766e;background:#0f766e;color:#fff}' +
      '.bloq button.sec,.bloq a.sec{background:#fff;color:#0f766e}' +
      '.bloq .aviso{color:#a12a3d;font-size:.88rem}.bloq .ok{color:#2e7d32;font-size:.88rem}';
    document.head.appendChild(s);
  }
  function el(tag, cls, txt){ var e = document.createElement(tag); if(cls) e.className = cls; if(txt != null) e.textContent = txt; return e; }

  // alvo: elemento que recebe a tela. ops: {aoVerificar: async()=>bool, aoSair: fn}
  A.mostrarBloqueio = function(alvo, res, sessao, ops){
    css(); alvo.innerHTML = '';
    var p = res.perfil || {}, caixa = el('div', 'bloq');
    var titulo, texto, mostrarPix = false;
    if(res.estado === 'vencido'){
      titulo = 'Assinatura vencida'; mostrarPix = true;
      texto = 'Seu acesso terminou em ' + dataBR(p.vencimento) + '. Para continuar, faça o pagamento pelo Pix abaixo e envie o comprovante. ' +
              'Assim que o pagamento for confirmado, o acesso é liberado. Seus dados continuam guardados.';
    } else if(res.estado === 'desativado'){
      titulo = 'Acesso desativado'; texto = 'Este login está desativado. Fale com o administrador do sistema.';
    } else if(res.estado === 'ubs_inativa'){
      titulo = 'UBS suspensa'; texto = 'O acesso desta UBS está suspenso. Fale com o administrador do sistema.';
    } else if(res.estado === 'sem_perfil'){
      titulo = 'Acesso ainda não liberado'; texto = 'Este login ainda não foi vinculado a uma UBS. Fale com o administrador do sistema.';
    } else {
      titulo = 'Conecte-se à internet'; texto = 'Para liberar o acesso neste aparelho, abra o Portal TACS uma vez com internet.';
    }
    caixa.appendChild(el('h2', null, titulo));
    caixa.appendChild(el('p', null, texto));

    if(mostrarPix){
      var img = el('img', 'qr'); img.src = CFG.PIX_IMG; img.alt = 'QR Code do Pix';
      img.onerror = function(){ img.replaceWith(el('p', 'aviso', 'QR Code do Pix indisponível. Fale com o administrador.')); };
      caixa.appendChild(img);
      if(CFG.VALOR) caixa.appendChild(el('div', 'valor', CFG.VALOR));
      caixa.appendChild(el('p', null, 'Abra o app do seu banco, escolha Pix > Ler QR Code.'));
    }

    var acoes = el('div', 'acoes'), status = el('p', 'aviso'); status.hidden = true;
    if(mostrarPix && CFG.PIX_COPIA_COLA){
      var cp = el('button', 'sec', 'Copiar código Pix (copia e cola)');
      cp.onclick = function(){
        var fim = function(){ cp.textContent = 'Código copiado'; setTimeout(function(){ cp.textContent = 'Copiar código Pix (copia e cola)'; }, 2500); };
        if(navigator.clipboard) navigator.clipboard.writeText(CFG.PIX_COPIA_COLA).then(fim, fim); else fim();
      };
      acoes.appendChild(cp);
    }
    if(CFG.WHATSAPP){
      var msg = 'Olá! ' + (mostrarPix ? 'Paguei a assinatura' : 'Preciso de ajuda com o acesso') + ' do Portal TACS.' +
                '\nNome: ' + (p.nome || '') + '\nE-mail: ' + sessao.user.email + '\nUBS: ' + (p.ubs_nome || '');
      var w = el('a', 'bt sec', mostrarPix ? 'Enviar comprovante pelo WhatsApp' : 'Falar com o administrador');
      w.href = 'https://wa.me/' + CFG.WHATSAPP + '?text=' + encodeURIComponent(msg); w.target = '_blank'; w.rel = 'noopener';
      acoes.appendChild(w);
    }
    if(ops && ops.aoVerificar){
      var v = el('button', null, mostrarPix ? 'Já paguei — verificar liberação' : 'Verificar novamente');
      v.onclick = async function(){
        v.disabled = true; status.hidden = true;
        var ok = false;
        try{ ok = await ops.aoVerificar(); }catch(e){}
        v.disabled = false;
        if(!ok){
          status.textContent = navigator.onLine ? 'Ainda não consta a liberação. Se já pagou, envie o comprovante e aguarde a confirmação.' : 'Sem internet no momento.';
          status.hidden = false;
        }
      };
      acoes.appendChild(v);
    }
    if(ops && ops.aoSair){ var s = el('button', 'sec', 'Sair'); s.onclick = ops.aoSair; acoes.appendChild(s); }
    caixa.appendChild(acoes); caixa.appendChild(status);
    alvo.appendChild(caixa);
  };
})();
