function mostrarConfirmacion(mensaje) {
  return new Promise(resolve => {
    const cont = document.getElementById("modal-generico-contenido");
    cont.replaceChildren();
    const texto = document.createElement("p");
    texto.className = "modal-mensaje";
    texto.textContent = mensaje.replace(/<br\s*\/?\s*>/gi, "\n");
    texto.style.whiteSpace = "pre-line";
    const botones = document.createElement("div");
    botones.className = "modal-botones";
    botones.innerHTML = '<button class="btn-modal-cancelar" id="modal-btn-no">Cancelar</button><button class="btn-modal-confirmar" id="modal-btn-si">Confirmar</button>';
    cont.append(texto, botones);
    document.getElementById("modal-generico").classList.remove("oculto");
    document.getElementById("modal-btn-si").onclick = () => { cerrarModalGenerico(); resolve(true); };
    document.getElementById("modal-btn-no").onclick = () => { cerrarModalGenerico(); resolve(false); };
  });
}

function mostrarPrompt(mensaje, valorDefault = "") {
  return new Promise(resolve => {
    const cont = document.getElementById("modal-generico-contenido");
    cont.innerHTML = '<p class="modal-mensaje"></p><input type="text" id="modal-input-valor"><div class="modal-botones"><button class="btn-modal-cancelar" id="modal-btn-cancelar">Cancelar</button><button class="btn-modal-confirmar" id="modal-btn-aceptar">Aceptar</button></div>';
    cont.querySelector(".modal-mensaje").textContent = mensaje;
    document.getElementById("modal-input-valor").value = valorDefault;
    document.getElementById("modal-generico").classList.remove("oculto");
    document.getElementById("modal-input-valor").focus();
    document.getElementById("modal-btn-aceptar").onclick = () => {
      const valor = document.getElementById("modal-input-valor").value;
      cerrarModalGenerico();
      resolve(valor);
    };
    document.getElementById("modal-btn-cancelar").onclick = () => { cerrarModalGenerico(); resolve(null); };
  });
}

function mostrarAlerta(mensaje) {
  const cont = document.getElementById("modal-generico-contenido");
  cont.innerHTML = '<p class="modal-mensaje"></p><button id="modal-btn-ok">Aceptar</button>';
  cont.querySelector(".modal-mensaje").textContent = mensaje.replace(/<br\s*\/?\s*>/gi, "\n");
  cont.querySelector(".modal-mensaje").style.whiteSpace = "pre-line";
  document.getElementById("modal-generico").classList.remove("oculto");
  document.getElementById("modal-btn-ok").onclick = cerrarModalGenerico;
}

function cerrarModalGenerico() {
  document.getElementById("modal-generico").classList.add("oculto");
}
