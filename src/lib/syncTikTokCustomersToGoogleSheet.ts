import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getGoogleSheetsClient } from "@/lib/googleSheets";

const SHEET_NAME = "TikTok Customers";

export async function syncTikTokCustomersToGoogleSheet() {
  /*
   * 1. Read the latest TikTok customers
   *    from Supabase.
   */

  const { data: customers, error: customerError } =
    await supabaseAdmin
      .from("tiktok_customers")
      .select(
        `
        tiktok_user_id,
        name,
        email,
        phone,
        order_count,
        gross_spend,
        currency,
        first_order_at,
        last_order_at,
        first_order_id,
        last_order_id,
        source,
        marketing_eligible
        `
      )
      .order("last_order_at", {
        ascending: false,
      });

  if (customerError) {
    throw new Error(
      `Could not read TikTok customers: ${customerError.message}`
    );
  }

  /*
   * 2. Connect to Google Sheets.
   */

  const {
    sheets,
    spreadsheetId,
  } = getGoogleSheetsClient();

  /*
   * 3. Check whether the TikTok Customers
   *    tab exists.
   */

  const spreadsheet =
    await sheets.spreadsheets.get({
      spreadsheetId,
      fields:
        "sheets.properties.title",
    });

  const sheetExists =
    (spreadsheet.data.sheets ?? []).some(
      (sheet) =>
        sheet.properties?.title ===
        SHEET_NAME
    );

  /*
   * 4. Create the tab if necessary.
   */

  if (!sheetExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,

      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: SHEET_NAME,
              },
            },
          },
        ],
      },
    });
  }

  /*
   * 5. Spreadsheet headings.
   */

  const header = [
    "TikTok User ID",
    "Name",
    "Email",
    "Phone",
    "Order Count",
    "Gross Spend",
    "Currency",
    "First Order Date",
    "Last Order Date",
    "First Order ID",
    "Last Order ID",
    "Source",
    "Marketing Eligible",
  ];

  /*
   * 6. Convert Supabase customers
   *    into spreadsheet rows.
   */

  const rows =
    (customers ?? []).map(
      (customer) => [
        customer.tiktok_user_id
          ? String(customer.tiktok_user_id)
          : "",

        customer.name ?? "",

        customer.email ?? "",

        customer.phone
          ? String(customer.phone)
          : "",

        customer.order_count ?? 0,

        customer.gross_spend ?? 0,

        customer.currency ?? "",

        customer.first_order_at ?? "",

        customer.last_order_at ?? "",

        customer.first_order_id
          ? String(customer.first_order_id)
          : "",

        customer.last_order_id
          ? String(customer.last_order_id)
          : "",

        customer.source ??
          "TikTok Shop",

        customer.marketing_eligible
          ? "TRUE"
          : "FALSE",
      ]
    );

  /*
   * 7. Clear the previous export.
   *
   * This prevents duplicate customer rows.
   */

  await sheets.spreadsheets.values.clear({
    spreadsheetId,

    range:
      `'${SHEET_NAME}'!A:M`,
  });

  /*
   * 8. Write the latest version.
   *
   * RAW is intentional:
   * it prevents Google from modifying
   * long TikTok IDs and phone numbers.
   */

  await sheets.spreadsheets.values.update({
    spreadsheetId,

    range:
      `'${SHEET_NAME}'!A1`,

    valueInputOption:
      "RAW",

    requestBody: {
      values: [
        header,
        ...rows,
      ],
    },
  });

  return {
    customers_synced:
      rows.length,

    sheet:
      SHEET_NAME,
  };
}