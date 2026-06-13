declare module 'pdf-parse' {
  interface PdfData {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
    version: string;
  }
  function pdfParse(
    dataBuffer: Buffer,
    options?: { max?: number; version?: string },
  ): Promise<PdfData>;
  export = pdfParse;
}
