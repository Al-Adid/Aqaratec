import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import {
  readTemplateFile,
  preflightTemplateDocx,
} from "./template-file-import";
const require = createRequire(import.meta.url);
const localRequire = createRequire(require.resolve("mammoth"));
const Zip = localRequire("jszip");
async function fixture(): Promise<ArrayBuffer> {
  const zip = new Zip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>نموذج صوري {{الاسم}} رقم {{رقم_العقار}} الكهرباء {{رقم_الكهرباء}} النوع {{نوع_العقار}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
  );
  const bytes: Uint8Array = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  return new Uint8Array(bytes).buffer;
}
describe("real browser DOCX reader", () => {
  it("extracts Arabic and tokens from a real DOCX archive", async () => {
    const data = await fixture();
    const result = await readTemplateFile({
      name: "عقد.docx",
      size: data.byteLength,
      arrayBuffer: async () => data,
    } as File);
    expect(result.content).toContain("نموذج صوري {{الاسم}}");
    expect(result.content).toContain("{{رقم_الكهرباء}}");
    expect(result.warning).toContain("تنسيق Word");
  });
  it("blocks encrypted flags before extraction", async () => {
    const data = await fixture(),
      bytes = new Uint8Array(data),
      v = new DataView(data);
    let found = false;
    for (let i = 0; i < bytes.length - 46; i++) {
      if (v.getUint32(i, true) === 0x02014b50) {
        v.setUint16(i + 8, 1, true);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    expect(() => preflightTemplateDocx(data)).toThrow("محمي");
  });
});
