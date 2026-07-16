function mostrarConfirmacion(mensaje) {
  return new Promise(resolve => {
    const cont = document.getElementById("modal-generico-contenido");
    cont.innerHTML = `
      <p class="modal-mensaje">${mensaje}</p>
      <div class="modal-botones">
        <button class="btn-modal-cancelar" id="modal-btn-no">Cancelar</button>
        <button class="btn-modal-confirmar" id="modal-btn-si">Confirmar</button>
      </div>`;
    document.getElementById("modal-generico").classList.remove("oculto");
    document.getElementById("modal-btn-si").onclick = () => { cerrarModalGenerico(); resolve(true); };
    document.getElementById("modal-btn-no").onclick = () => { cerrarModalGenerico(); resolve(false); };
  });
}

function mostrarPrompt(mensaje, valorDefault = "") {
  return new Promise(resolve => {
    const cont = document.getElementById("modal-generico-contenido");
    cont.innerHTML = `
      <p class="modal-mensaje">${mensaje}</p>
      <input type="text" id="modal-input-valor" value="${valorDefault}">
      <div class="modal-botones">
        <button class="btn-modal-cancelar" id="modal-btn-cancelar">Cancelar</button>
        <button class="btn-modal-confirmar" id="modal-btn-aceptar">Aceptar</button>
      </div>`;
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
  cont.innerHTML = `<p class="modal-mensaje">${mensaje}</p><button id="modal-btn-ok">Aceptar</button>`;
  document.getElementById("modal-generico").classList.remove("oculto");
  document.getElementById("modal-btn-ok").onclick = cerrarModalGenerico;
}

function cerrarModalGenerico() {
  document.getElementById("modal-generico").classList.add("oculto");
}