// Node에서 PDF 파일 → pdftext.js 페이지 배열. 브라우저는 pdf.js를 직접 쓴다.
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { documentToPages } from '../public/pdftext.js';

export async function readPdf(path) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(path)),
    useSystemFonts: true,
  }).promise;
  return documentToPages(doc);
}
