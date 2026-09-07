(function initializeConstanciasDrivePdf() {
  "use strict";

  const BUTTON_TEXT = "CREAR PDF Y GUARDAR EN DRIVE";
  let generating = false;
  let downloading = false;

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  function withTimeout(promise, timeoutMs) {
    return Promise.race([
      promise,
      new Promise((resolve) => window.setTimeout(resolve, timeoutMs)),
    ]);
  }

  async function waitForImages(root, timeoutMs = 12000) {
    const images = Array.from(root.querySelectorAll("img"));
    await Promise.all(images.map(async (image) => {
      if (!image.complete || image.naturalWidth === 0) {
        await withTimeout(new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        }), timeoutMs);
      }
      if (typeof image.decode === "function" && image.naturalWidth > 0) {
        await withTimeout(image.decode().catch(() => {}), timeoutMs);
      }
    }));
  }

  function waitForPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    });
  }

  function getCaptureArea() {
    return document.getElementById("print-capture-area");
  }

  function getCertificatePages(captureArea) {
    return Array.from(captureArea.querySelectorAll(".diploma-canvas"));
  }

  function getControlValue(labels) {
    const wanted = labels.map(normalize);
    for (const label of document.querySelectorAll("label")) {
      const labelText = normalize(label.textContent);
      if (!wanted.some((item) => labelText.includes(item))) continue;
      const container = label.parentElement;
      const control = container?.querySelector("select, input:not([type='file'])");
      if (control?.value) return String(control.value).trim();
    }
    return "";
  }

  function readMetadata() {
    const capacitacionMatch = window.location.pathname.match(/\/capacitaciones\/([^/]+)/i);
    const sucursalLabel = String(
      document.querySelector("#print-capture-area .sucursal-label")?.textContent
        || document.querySelector(".sucursal-label")?.textContent
        || "SUCURSAL",
    ).replace(/\s+/g, " ").trim();
    const sucursalId = getControlValue(["UNIDAD DE NEGOCIO", "SUCURSAL", "SEDE"]);
    const timestamp = new Intl.DateTimeFormat("sv-SE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date()).replace(" ", "_").replace(":", "-");
    const safeLabel = sucursalLabel.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
    return {
      capacitacionId: capacitacionMatch ? decodeURIComponent(capacitacionMatch[1]) : "",
      sucursalId,
      sucursalLabel,
      fileName: `${safeLabel || "CONSTANCIAS"} DIP ${timestamp}.pdf`,
      csvFileName: `${safeLabel || "CONSTANCIAS"} PARTICIPANTES ${timestamp}.csv`,
    };
  }

  function createParticipantsCsvBlob() {
    const captureArea = getCaptureArea();
    const names = captureArea
      ? Array.from(captureArea.querySelectorAll(".recipient-name"))
        .map((element) => String(element.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
      : [];
    if (names.length === 0) {
      throw new Error("No hay participantes para exportar al CSV.");
    }
    const escapeCsv = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const content = `\uFEFFNOMBRE\r\n${names.map(escapeCsv).join("\r\n")}\r\n`;
    return new Blob([content], { type: "text/csv;charset=utf-8" });
  }

  function rememberCaptureStyles(captureArea) {
    const names = ["position", "opacity", "height", "overflow", "width", "display", "pointerEvents", "zIndex"];
    const previous = Object.fromEntries(names.map((name) => [name, captureArea.style[name]]));
    Object.assign(captureArea.style, {
      position: "relative",
      opacity: "1",
      height: "auto",
      overflow: "visible",
      width: "11in",
      display: "block",
      pointerEvents: "auto",
      zIndex: "1",
    });
    return () => names.forEach((name) => { captureArea.style[name] = previous[name]; });
  }

  async function createPdfBlob() {
    const captureArea = getCaptureArea();
    const pages = captureArea ? getCertificatePages(captureArea) : [];
    if (!captureArea || pages.length === 0) {
      throw new Error("Primero selecciona la capacitacion, sucursal y participantes.");
    }

    const JsPdf = window.jspdf?.jsPDF || window.jsPDF;
    if (!JsPdf || !window.html2canvas) {
      throw new Error("No se cargaron las herramientas para crear el PDF.");
    }

    const restoreStyles = rememberCaptureStyles(captureArea);
    document.body.classList.add("capturing");

    try {
      if (document.fonts) await document.fonts.ready;
      await waitForPaint();
      await waitForImages(captureArea);
      await waitForPaint();

      const pdf = new JsPdf({ unit: "in", format: [11, 8.5], orientation: "landscape" });
      for (let index = 0; index < pages.length; index += 1) {
        await waitForImages(pages[index]);
        await waitForPaint();
        const canvas = await window.html2canvas(pages[index], {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: "#ffffff",
          imageTimeout: 15000,
          scrollX: 0,
          scrollY: 0,
          width: 1056,
          height: 816,
          windowWidth: 1056,
          windowHeight: 816,
        });
        if (index > 0) pdf.addPage([11, 8.5], "landscape");
        pdf.addImage(
          canvas.toDataURL("image/jpeg", 0.98),
          "JPEG",
          0.15,
          0.15,
          10.7,
          8.2,
          `constancia-${index + 1}`,
          "FAST",
        );
      }
      return pdf.output("blob");
    } finally {
      document.body.classList.remove("capturing");
      restoreStyles();
    }
  }

  function showNotice(message, type = "success", url = "") {
    document.querySelector(".constancias-drive-notice")?.remove();
    const notice = document.createElement("div");
    notice.className = `constancias-drive-notice constancias-drive-notice--${type}`;
    notice.setAttribute("role", type === "error" ? "alert" : "status");
    const text = document.createElement("span");
    text.textContent = message;
    notice.appendChild(text);
    if (url) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "ABRIR EN DRIVE";
      notice.appendChild(link);
    }
    document.body.appendChild(notice);
    window.setTimeout(() => notice.remove(), url ? 12000 : 7000);
  }

  async function savePdfToDrive(button) {
    if (generating) return;
    generating = true;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "CREANDO PDF...";

    try {
      const metadata = readMetadata();
      const pdf = await createPdfBlob();
      const csv = createParticipantsCsvBlob();
      button.textContent = "GUARDANDO EN DRIVE...";
      const query = new URLSearchParams({
        capacitacionId: metadata.capacitacionId,
        sucursalId: metadata.sucursalId,
        sucursalLabel: metadata.sucursalLabel,
        fileName: metadata.fileName,
      });
      const response = await fetch(`/constancias/api/pdf/drive?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: pdf,
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "No fue posible guardar el PDF en Drive.");
      }
      const csvQuery = new URLSearchParams({
        capacitacionId: metadata.capacitacionId,
        sucursalId: metadata.sucursalId,
        sucursalLabel: metadata.sucursalLabel,
        fileName: metadata.csvFileName,
      });
      const csvResponse = await fetch(`/constancias/api/csv/drive?${csvQuery}`, {
        method: "POST",
        headers: { "Content-Type": "text/csv; charset=utf-8" },
        body: csv,
        credentials: "same-origin",
      });
      const csvPayload = await csvResponse.json().catch(() => ({}));
      if (!csvResponse.ok || !csvPayload.ok) {
        throw new Error(csvPayload.error || "El PDF se guardo, pero no fue posible guardar el CSV en Drive.");
      }
      showNotice(
        `PDF y CSV guardados en Drive: ${payload.file?.name || metadata.fileName}`,
        "success",
        payload.file?.url,
      );
    } catch (error) {
      console.error("[constancias-drive]", error);
      showNotice(error.message || "No fue posible guardar el PDF en Drive.", "error");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
      generating = false;
    }
  }

  async function downloadPdf(button) {
    if (downloading || generating) return;
    downloading = true;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "CREANDO PDF...";

    try {
      const metadata = readMetadata();
      const pdf = await createPdfBlob();
      const url = URL.createObjectURL(pdf);
      const link = document.createElement("a");
      link.href = url;
      link.download = metadata.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error("[constancias-download]", error);
      showNotice(error.message || "No fue posible descargar el PDF.", "error");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
      downloading = false;
    }
  }

  function installDownloadHandler(button) {
    if (button.dataset.constanciasDownloadInstalled === "true") return;
    button.dataset.constanciasDownloadInstalled = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      downloadPdf(button);
    }, true);
  }

  function installButtons() {
    for (const original of document.querySelectorAll("button")) {
      if (!normalize(original.textContent).includes("DESCARGAR PDF")) continue;
      installDownloadHandler(original);
      const parent = original.parentElement;
      if (!parent || parent.querySelector(".constancias-drive-button")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "constancias-drive-button";
      button.textContent = BUTTON_TEXT;
      button.addEventListener("click", () => savePdfToDrive(button));
      parent.appendChild(button);
    }
  }

  const observer = new MutationObserver(installButtons);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", installButtons);
  installButtons();
}());
