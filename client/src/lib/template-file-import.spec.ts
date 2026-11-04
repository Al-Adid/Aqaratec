import { describe, it, expect } from "vitest";
import {
  readTemplateFile,
  preflightTemplateDocx,
} from "./template-file-import";
const file = (name: string, text: string): File =>
  ({
    name,
    size: new TextEncoder().encode(text).byteLength,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  }) as File;
describe("local contract template upload", () => {
  it("reads an Arabic UTF8 TXT without sending it to a service", async () => {
    const result = await readTemplateFile(
      file("نموذج.txt", "نص {{الاسم}}\r\nرقم {{رقم_العقار}}")
    );
    expect(result.content).toBe("نص {{الاسم}}\nرقم {{رقم_العقار}}");
    expect(result.fileName).toBe("نموذج.txt");
    expect(result.warning).toContain("محلي");
  });
  it("rejects PDF, old DOC, empty,oversized and overlong text files", async () => {
    await expect(readTemplateFile(file("x.pdf", "%PDF"))).rejects.toThrow(
      "غير مدعومة"
    );
    await expect(readTemplateFile(file("x.doc", "x"))).rejects.toThrow(
      "غير مدعومة"
    );
    await expect(readTemplateFile(file("x.txt", ""))).rejects.toThrow(
      "غير فارغ"
    );
    await expect(
      readTemplateFile({ name: "x.docx", size: 3 * 1024 * 1024 } as File)
    ).rejects.toThrow("2MB");
    await expect(
      readTemplateFile(file("x.txt", "a".repeat(16001)))
    ).rejects.toThrow("16000");
  });
  it("blocks binary text and malformed Word before the decompressor", async () => {
    await expect(
      readTemplateFile({
        name: "x.txt",
        size: 3,
        arrayBuffer: async () => new Uint8Array([255, 254, 250]).buffer,
      } as File)
    ).rejects.toThrow("UTF-8");
    expect(() => preflightTemplateDocx(new Uint8Array(30).buffer)).toThrow(
      "غير صالح"
    );
  });
});
