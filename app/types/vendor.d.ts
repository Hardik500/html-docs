declare module "html-to-docx" {
  interface HtmlToDocxOptions {
    table?: {
      row?: {
        cantSplit?: boolean;
      };
    };
    footer?: boolean;
    pageNumber?: boolean;
    [key: string]: unknown;
  }

  const htmlToDocx: (
    html: string,
    headerHTML?: string,
    options?: HtmlToDocxOptions,
  ) => Promise<ArrayBuffer>;

  export default htmlToDocx;
}
