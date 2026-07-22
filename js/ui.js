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

function mostrarPrompt(mensaje, valorDefault = "", formatoDinero = false) {
  return new Promise(resolve => {
    const cont = document.getElementById("modal-generico-contenido");
    cont.innerHTML = '<p class="modal-mensaje"></p><input type="text" id="modal-input-valor"><div class="modal-botones"><button class="btn-modal-cancelar" id="modal-btn-cancelar">Cancelar</button><button class="btn-modal-confirmar" id="modal-btn-aceptar">Aceptar</button></div>';
    cont.querySelector(".modal-mensaje").textContent = mensaje;
    const input = document.getElementById("modal-input-valor");

    if (formatoDinero) {
      input.setAttribute("inputmode", "numeric");
      formatearMoneda(input);
      const valorNumerico = Number(String(valorDefault).replace(/\D/g, "")) || 0;
      input.value = "$" + valorNumerico.toLocaleString("es-CO");
    } else {
      input.value = valorDefault;
    }

    document.getElementById("modal-generico").classList.remove("oculto");
    input.focus();
    document.getElementById("modal-btn-aceptar").onclick = () => {
      const valor = input.value;
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

// --- ACTIVACIÓN POR TECLADO DE ELEMENTOS "role=button" ---
// Varias tarjetas y enlaces de la app (ej. la tarjeta de un cliente en la
// lista, el 🗑️ de borrar un pago) son <div>/<span>/<p> con onclick, no
// <button> reales, para no romper el diseño (flex, grid, texto en línea).
// Se les agrega role="button" + tabindex="0" en su HTML; este único
// listener delegado hace que Enter o Espacio los activen igual que un
// clic, sin repetir el mismo onkeydown en cada plantilla.
document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Enter" && evento.key !== " ") return;
  const elemento = evento.target.closest('[role="button"]');
  if (!elemento) return;
  evento.preventDefault();
  elemento.click();
});
