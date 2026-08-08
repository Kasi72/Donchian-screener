import { NextResponse } from "next/server";
import { parseUniverseCsv } from "@/lib/universe/parse-csv";

export async function POST(request: Request): Promise<NextResponse> {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A CSV file is required" }, { status: 400 });
  }

  return NextResponse.json(parseUniverseCsv(await file.text()));
}
