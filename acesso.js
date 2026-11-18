/* Portal TACS — acesso por UBS e assinatura.
   Lê o perfil do usuário (UBS, papel, vencimento), guarda uma cópia no aparelho para o modo offline
   e mostra a tela de bloqueio com o Pix quando a assinatura vence.
   Atenção: a trava de verdade fica no banco (escala.sql). Esta tela é só a parte visível. */
(function(){
  'use strict';

  /* ======== CONFIGURE AQUI ======== */
  var CFG = {
    // Opção 1 (recomendada): preencha a chave e o app gera o QR Code e o "copia e cola" sozinho
    PIX_CHAVE: '+5599991723550',               // sua chave Pix (CPF, e-mail, telefone ou chave aleatória)
    PIX_NOME: 'RAIDON RODRIGUES SOUSA',                // nome do recebedor, como no banco (até 25 letras)
    PIX_CIDADE: 'ALTO ALEGRE DO MARANHÃO',              // cidade do recebedor (até 15 letras)
    PIX_VALOR: 100,                // valor da assinatura em reais, ex.: 49.90 (0 = o cliente digita)
    // Opção 2: cole aqui um código Pix "copia e cola" já pronto (vale no lugar da opção 1)
    PIX_COPIA_COLA: '',
    // Opção 3: só uma imagem de QR Code (arquivo na mesma pasta)
    PIX_IMG: 'pix.png',
    PERIODO: '30 dias',          // quanto tempo cada pagamento libera (texto da tela)
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


  /* ---------- Código Pix (BR Code estático) ---------- */
  function tlv(id, v){ return id + ('0' + v.length).slice(-2) + v; }
  function crc16(str){
    var c = 0xFFFF;
    for(var i = 0; i < str.length; i++){
      c ^= str.charCodeAt(i) << 8;
      for(var j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
    }
    return ('000' + c.toString(16).toUpperCase()).slice(-4);
  }
  function limpar(t, n){ return String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, n); }
  function codigoPix(){
    if(CFG.PIX_COPIA_COLA) return CFG.PIX_COPIA_COLA.trim();
    if(!CFG.PIX_CHAVE || !CFG.PIX_NOME || !CFG.PIX_CIDADE) return '';
    var conta = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', CFG.PIX_CHAVE.trim());
    var p = tlv('00', '01') + tlv('01', '11') + tlv('26', conta) + tlv('52', '0000') + tlv('53', '986') +
            (CFG.PIX_VALOR > 0 ? tlv('54', Number(CFG.PIX_VALOR).toFixed(2)) : '') + tlv('58', 'BR') +
            tlv('59', limpar(CFG.PIX_NOME, 25)) + tlv('60', limpar(CFG.PIX_CIDADE, 15)) + tlv('62', tlv('05', '***')) + '6304';
    return p + crc16(p);
  }
  function reais(v){ return 'R$ ' + Number(v).toFixed(2).replace('.', ','); }
  A.codigoPix = codigoPix;

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
      '.bloq .aviso{color:#a12a3d;font-size:.88rem}.bloq .ok{color:#2e7d32;font-size:.88rem}' +
      '.bloq{overflow:hidden}.bloq .cab{background:#1f7a3a;color:#fff;margin:-28px -26px 18px;padding:16px 22px;text-align:left}' +
      '.bloq .cab h2{margin:0;font-size:1.1rem}.bloq .cab small{display:block;margin-top:3px;opacity:.85;font-size:.82rem}' +
      '.bloq .qrbox svg{display:block;margin:14px auto 4px;width:min(280px,72vw);height:auto;border:1px solid #d3e2de;border-radius:12px}' +
      '.bloq .rot{margin:16px 0 6px;text-align:left;font-size:.7rem;font-weight:600;letter-spacing:.08em;color:#62766f}' +
      '.bloq .cc{text-align:left;font-size:.8rem;line-height:1.5;word-break:break-all;border:1px solid #d3e2de;border-radius:10px;padding:12px 14px;background:#f7faf9;color:#17302b}';
    document.head.appendChild(s);
  }
  function el(tag, cls, txt){ var e = document.createElement(tag); if(cls) e.className = cls; if(txt != null) e.textContent = txt; return e; }

  // alvo: elemento que recebe a tela. ops: {aoVerificar: async()=>bool, aoSair: fn}
  A.mostrarBloqueio = function(alvo, res, sessao, ops){
    css(); alvo.innerHTML = '';
    var p = res.perfil || {}, caixa = el('div', 'bloq');
    var titulo, sub = '', texto, mostrarPix = false;
    if(res.estado === 'vencido'){
      titulo = 'Assinatura vencida'; sub = 'Renove seu acesso para continuar'; mostrarPix = true;
      texto = 'Seu acesso mensal' + (CFG.PIX_VALOR > 0 ? ' (' + reais(CFG.PIX_VALOR) + ')' : '') + ' venceu em ' + dataBR(p.vencimento) + '. ' +
              'Escaneie o QR Code ou copie o código PIX abaixo para renovar. Seu acesso é liberado por mais ' + CFG.PERIODO +
              ' após a confirmação do pagamento. Seus dados continuam guardados.';
    } else if(res.estado === 'desativado'){
      titulo = 'Acesso desativado'; texto = 'Este login está desativado. Fale com o administrador do sistema.';
    } else if(res.estado === 'ubs_inativa'){
      titulo = 'UBS suspensa'; texto = 'O acesso desta UBS está suspenso. Fale com o administrador do sistema.';
    } else if(res.estado === 'sem_perfil'){
      titulo = 'Acesso ainda não liberado'; texto = 'Este login ainda não foi vinculado a uma UBS. Fale com o administrador do sistema.';
    } else {
      titulo = 'Conecte-se à internet'; texto = 'Para liberar o acesso neste aparelho, abra o Portal TACS uma vez com internet.';
    }
    var cab = el('div', 'cab'); cab.appendChild(el('h2', null, titulo)); if(sub) cab.appendChild(el('small', null, sub));
    caixa.appendChild(cab);
    caixa.appendChild(el('p', null, texto));

    var codigo = mostrarPix ? codigoPix() : '';
    if(mostrarPix){
      var desenhou = false;
      if(codigo && typeof qrcode === 'function'){
        try{
          var qr = qrcode(0, 'M'); qr.addData(codigo); qr.make();
          var box = el('div', 'qrbox'); box.innerHTML = qr.createSvgTag({cellSize: 4, margin: 2, scalable: true});
          caixa.appendChild(box); desenhou = true;
        }catch(e){}
      }
      if(!desenhou){
        var img = el('img', 'qr'); img.src = CFG.PIX_IMG; img.alt = 'QR Code do Pix';
        img.onerror = function(){ img.replaceWith(el('p', 'aviso', 'QR Code do Pix indisponível. Fale com o administrador.')); };
        caixa.appendChild(img);
      }
      if(codigo){
        caixa.appendChild(el('div', 'rot', 'PIX COPIA E COLA'));
        caixa.appendChild(el('div', 'cc', codigo));
      }
    }

    var acoes = el('div', 'acoes'), status = el('p', 'aviso'); status.hidden = true;
    if(codigo){
      var cp = el('button', null, 'Copiar código PIX');
      cp.onclick = function(){
        var fim = function(){ cp.textContent = 'Código copiado ✓'; setTimeout(function(){ cp.textContent = 'Copiar código PIX'; }, 2500); };
        if(navigator.clipboard) navigator.clipboard.writeText(codigo).then(fim, fim); else fim();
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
      var v = el('button', codigo ? 'sec' : null, mostrarPix ? 'Já paguei — verificar liberação' : 'Verificar novamente');
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