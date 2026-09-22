import { getGoogleSheetsClient }
  from "@/lib/googleSheets";

export async function GET() {
  try {
    const {
      sheets,
      spreadsheetId,
    } = getGoogleSheetsClient();

    const result =
      await sheets.spreadsheets.get({
        spreadsheetId,

        fields:
          "properties.title,sheets.properties.title",
      });

    return Response.json({
      success: true,

      connected: true,

      spreadsheet_title:
        result.data.properties?.title ??
        null,

      tabs:
        result.data.sheets?.map(
          (sheet) =>
            sheet.properties?.title
        ) ?? [],
    });
  } catch (error) {
    return Response.json(
      {
        success: false,

        connected: false,

        message:
          error instanceof Error
            ? error.message
            : "Google Sheets connection failed",
      },
      {
        status: 500,
      }
    );
  }
}