/**
 * lib/ipfs/verify.ts — lets anyone confirm a CID's content hasn't been
 * tampered with, reinforcing "on-chain hash = permanent proof"
 */
export async function fetchAndVerify(cid: string): Promise<unknown> {
  const gateway = process.env.PINATA_GATEWAY || "gateway.pinata.cloud";
  const res = await fetch(`https://${gateway}/ipfs/${cid}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${cid}: ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.blob();
}
