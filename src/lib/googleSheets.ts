import { google } from "googleapis";

export function getGoogleSheetsClient() {
  const spreadsheetId =
    process.env.GOOGLE_SHEET_ID;

  const clientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  const privateKey =
    process.env.GOOGLE_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n"
    );

  if (
    !spreadsheetId ||
    !clientEmail ||
    !privateKey
  ) {
    throw new Error(
      "Google Sheets environment variables are missing"
    );
  }

  const auth =
    new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },

      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
      ],
    });

  const sheets =
    google.sheets({
      version: "v4",
      auth,
    });

  return {
    sheets,
    spreadsheetId,
  };
}