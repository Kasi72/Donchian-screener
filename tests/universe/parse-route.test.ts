import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/universe/parse/route";

function upload(csv: string): Request {
  const form = new FormData();
  form.set("file", new File([csv], "universe.csv", { type: "text/csv" }));
  return new Request("http://localhost/api/universe/parse", { method: "POST", body: form });
}

describe("universe parse production bounds", () => {
  it("accepts the 500-row product universe", async () => {
    const csv = [
      "Symbol",
      ...Array.from({ length: 500 }, (_, index) => `S${index}`),
    ].join("\n");

    const response = await POST(upload(csv));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ totalRows: 500 });
  });

  it("rejects more than 1,000 data rows", async () => {
    const csv = [
      "Symbol",
      ...Array.from({ length: 1_001 }, (_, index) => `S${index}`),
    ].join("\n");

    const response = await POST(upload(csv));

    expect(response.status).toBe(413);
  });

  it("rejects a file larger than one MiB before reading it", async () => {
    const response = await POST(upload(`Symbol\n${"A".repeat(1_048_576)}`));

    expect(response.status).toBe(413);
  });
});
