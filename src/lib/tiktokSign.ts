import crypto from "crypto";

export function createTikTokSign(
  path: string,
  params: Record<string, string>,
  appSecret: string,
  body: string = ""
) {
  const keys = Object.keys(params)
    .filter((key) => key !== "sign" && key !== "access_token")
    .sort();

  let input = path;

  for (const key of keys) {
    input += key + params[key];
  }

  input += body;

  input = appSecret + input + appSecret;

  return crypto
    .createHmac("sha256", appSecret)
    .update(input)
    .digest("hex");
}