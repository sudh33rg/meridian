import { apiResponse } from "./api";

/** Fetches a CSV export with the signed-in session and saves it. Throws with the server's message on failure. */
export async function downloadCsv(path: string, token: string, filename: string): Promise<void> {
  const response = await apiResponse(path, token);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[^A-Za-z0-9._ -]+/g, "_");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
