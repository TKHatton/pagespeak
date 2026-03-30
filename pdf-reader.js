'use strict';

const pdfContent = document.getElementById('pdf-content');
const pdfLoading = document.getElementById('pdf-loading');
const pdfError = document.getElementById('pdf-error');
const pdfInfo = document.getElementById('pdf-info');
const btnReadAll = document.getElementById('btn-read-all');
const btnReadSelection = document.getElementById('btn-read-selection');

// Security: max pages to extract (prevents browser freeze on huge PDFs)
const MAX_PAGES = 500;

// Get PDF URL from query parameter
const params = new URLSearchParams(window.location.search);
const pdfUrl = params.get('url');

if (typeof pdfjsLib === 'undefined') {
  showError('PDF reader library failed to load. Try reloading the page.');
} else if (!pdfUrl) {
  showError('No PDF URL provided.');
} else if (!isValidPdfUrl(pdfUrl)) {
  showError('Invalid PDF URL. Only HTTP, HTTPS, and local file URLs are supported.');
} else {
  loadPDF(pdfUrl);
}

/**
 * Validate the PDF URL — only allow http, https, file, and blob protocols.
 */
function isValidPdfUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'file:', 'blob:'].includes(parsed.protocol);
  } catch (e) {
    return false;
  }
}

async function loadPDF(url) {
  try {
    // Configure pdf.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;

    const pageCount = Math.min(pdf.numPages, MAX_PAGES);
    const truncated = pdf.numPages > MAX_PAGES;
    pdfInfo.textContent = pdf.numPages + ' pages' + (truncated ? ` (showing first ${MAX_PAGES})` : '');
    let allText = '';

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      // Build text from items
      let pageText = '';
      let lastY = null;

      for (const item of textContent.items) {
        if (item.str === undefined) continue;

        // Detect line breaks by Y position change
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
          pageText += '\n';
        }
        pageText += item.str;
        lastY = item.transform[5];
      }

      // Create page element
      const pageEl = document.createElement('div');
      pageEl.className = 'pdf-page';

      const header = document.createElement('div');
      header.className = 'pdf-page-header';
      header.textContent = 'Page ' + i + ' of ' + pdf.numPages;
      pageEl.appendChild(header);

      // Split into paragraphs (double newlines)
      const paragraphs = pageText.split(/\n{2,}/);
      for (const para of paragraphs) {
        const trimmed = para.replace(/\n/g, ' ').trim();
        if (!trimmed) continue;

        const p = document.createElement('p');
        p.textContent = trimmed;
        pageEl.appendChild(p);
      }

      pdfContent.appendChild(pageEl);
      allText += pageText + '\n\n';
    }

    pdfLoading.style.display = 'none';
    pdfContent.style.display = 'block';
    btnReadAll.disabled = false;
    btnReadSelection.disabled = false;

    // Store full text for "Read All"
    btnReadAll.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'START_READING', text: allText.trim() });
    });

    btnReadSelection.addEventListener('click', () => {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';
      if (text) {
        chrome.runtime.sendMessage({ type: 'START_READING', text });
      }
    });

  } catch (err) {
    showError('Could not read PDF: ' + err.message);
  }
}

function showError(msg) {
  pdfLoading.style.display = 'none';
  pdfError.style.display = 'block';
  pdfError.textContent = msg;
}
