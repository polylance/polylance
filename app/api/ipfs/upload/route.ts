import { uploadFile, uploadJSON } from "../../../lib/ipfs/upload";
import { verifyWalletAuth } from "../../../lib/auth";

export async function POST(req: Request) {
  const authed = await verifyWalletAuth(req);
  if (!authed) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      const data = await req.json();
      const result = await uploadJSON(data);
      return Response.json(result);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }
    const result = await uploadFile(file);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
