import { NextResponse } from "next/server";
import { parseUniverseCsv } from "@/lib/universe/parse-csv";
import {
  MAX_UNIVERSE_ROWS,
  MAX_UPLOAD_BYTES,
} from "@/lib/server/request-limits";

export async function POST(request: Request): Promise<NextResponse> {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A CSV file is required" }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "CSV upload is too large" }, { status: 413 });
  }

  const result = parseUniverseCsv(await file.text());
  if (result.totalRows > MAX_UNIVERSE_ROWS) {
    return NextResponse.json({ error: "CSV has too many rows" }, { status: 413 });
  }

  return NextResponse.json(result);
}
