import { supabaseAdmin } from "@/lib/supabaseAdmin";

type TikTokOrderRow = {
  tiktok_order_id: string;
  status: string | null;
  created_at_tiktok: string | null;
  raw_detail: Record<string, any> | null;
};

function normalizeEmail(value: unknown) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!email || !email.includes("@") || email.includes("*")) {
    return "";
  }

  return email;
}

function normalizePhone(value: unknown) {
  const raw = String(value ?? "").trim();

  if (!raw || raw.includes("*")) {
    return "";
  }

  let digits = raw.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (digits.startsWith("00")) {
    return "+" + digits.slice(2);
  }

  if (digits.startsWith("39")) {
    return "+" + digits;
  }

  // Most Ticalbak customers are Italian.
  // Italian mobile numbers normally begin with 3.
  if (digits.startsWith("3") && digits.length === 10) {
    return "+39" + digits;
  }

  if (raw.startsWith("+")) {
    return "+" + digits;
  }

  return digits;
}

function parseMoney(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const objectValue = value as Record<string, unknown>;

    return parseMoney(
      objectValue.amount ??
        objectValue.value ??
        objectValue.total
    );
  }

  let text = String(value ?? "").trim();

  if (!text) {
    return 0;
  }

  text = text.replace(",", ".");
  text = text.replace(/[^\d.-]/g, "");

  const amount = Number(text);

  return Number.isFinite(amount) ? amount : 0;
}

function isCancelled(status: string | null) {
  const normalized = String(status ?? "").toUpperCase();

  return (
    normalized === "CANCELLED" ||
    normalized === "CANCELED"
  );
}

export async function GET() {
  const { data: orders, error: orderError } =
    await supabaseAdmin
      .from("tiktok_orders")
      .select(
        "tiktok_order_id, status, created_at_tiktok, raw_detail"
      )
      .eq("detail_synced", true)
      .not("raw_detail", "is", null)
      .range(0, 4999);

  if (orderError) {
    return Response.json(
      {
        success: false,
        message: "Could not read TikTok orders",
        error: orderError.message,
      },
      { status: 500 }
    );
  }

  const typedOrders =
    (orders ?? []) as TikTokOrderRow[];

  /*
   * Customer groups are rebuilt from the order database.
   *
   * Priority:
   * 1. TikTok user_id
   * 2. Email
   * 3. Phone
   */

  const customerGroups = new Map<
    string,
    TikTokOrderRow[]
  >();

  let ordersWithoutIdentity = 0;

  for (const order of typedOrders) {
    const detail = order.raw_detail ?? {};

    const userId = String(
      detail.user_id ?? ""
    ).trim();

    const email = normalizeEmail(
      detail.buyer_email
    );

    const phone = normalizePhone(
      detail.recipient_address?.phone_number
    );

    let identityKey = "";

    if (userId) {
      identityKey = `user:${userId}`;
    } else if (email) {
      identityKey = `email:${email}`;
    } else if (phone) {
      identityKey = `phone:${phone}`;
    }

    if (!identityKey) {
      ordersWithoutIdentity += 1;
      continue;
    }

    const existing =
      customerGroups.get(identityKey) ?? [];

    existing.push(order);

    customerGroups.set(
      identityKey,
      existing
    );
  }

  const customerRows = [];

  let cancelledOrdersExcluded = 0;

  for (const [, customerOrders] of customerGroups) {
    const names = new Set<string>();
    const emails = new Set<string>();
    const phones = new Set<string>();
    const userIds = new Set<string>();

    const currencies = new Map<
      string,
      number
    >();

    let grossSpend = 0;
    let orderCount = 0;

    for (const order of customerOrders) {
      const detail = order.raw_detail ?? {};

      const name = String(
        detail.recipient_address?.name ?? ""
      ).trim();

      const email = normalizeEmail(
        detail.buyer_email
      );

      const phone = normalizePhone(
        detail.recipient_address?.phone_number
      );

      const userId = String(
        detail.user_id ?? ""
      ).trim();

      if (name && !name.includes("*")) {
        names.add(name);
      }

      if (email) {
        emails.add(email);
      }

      if (phone) {
        phones.add(phone);
      }

      if (userId) {
        userIds.add(userId);
      }

      const currency = String(
        detail.payment?.currency ?? ""
      ).trim();

      if (currency) {
        currencies.set(
          currency,
          (currencies.get(currency) ?? 0) + 1
        );
      }

      if (isCancelled(order.status)) {
        cancelledOrdersExcluded += 1;
        continue;
      }

      orderCount += 1;

      grossSpend += parseMoney(
        detail.payment?.total_amount
      );
    }

    const sortedOrders = [...customerOrders]
      .filter((order) => order.created_at_tiktok)
      .sort(
        (a, b) =>
          new Date(
            a.created_at_tiktok as string
          ).getTime() -
          new Date(
            b.created_at_tiktok as string
          ).getTime()
      );

    const firstOrder =
      sortedOrders[0] ?? null;

    const lastOrder =
      sortedOrders[
        sortedOrders.length - 1
      ] ?? null;

    let mostCommonCurrency = "";

    let highestCurrencyCount = 0;

    for (const [currency, count] of currencies) {
      if (count > highestCurrencyCount) {
        highestCurrencyCount = count;
        mostCommonCurrency = currency;
      }
    }

    customerRows.push({
      tiktok_user_id:
        Array.from(userIds)[0] ?? null,

      name:
        Array.from(names)[0] ?? null,

      email:
        Array.from(emails)[0] ?? null,

      normalized_email:
        Array.from(emails)[0] ?? null,

      phone:
        Array.from(phones)[0] ?? null,

      normalized_phone:
        Array.from(phones)[0] ?? null,

      order_count: orderCount,

      gross_spend:
        Number(grossSpend.toFixed(2)),

      currency:
        mostCommonCurrency || null,

      first_order_at:
        firstOrder?.created_at_tiktok ?? null,

      last_order_at:
        lastOrder?.created_at_tiktok ?? null,

      first_order_id:
        firstOrder?.tiktok_order_id ?? null,

      last_order_id:
        lastOrder?.tiktok_order_id ?? null,

      source: "TikTok Shop",

      marketing_eligible: false,

      marketing_consent_source: null,

      updated_at:
        new Date().toISOString(),
    });
  }

  /*
   * tiktok_customers is a derived table.
   * Rebuild it from the authoritative order data.
   */

  const { error: deleteError } =
    await supabaseAdmin
      .from("tiktok_customers")
      .delete()
      .not("id", "is", null);

  if (deleteError) {
    return Response.json(
      {
        success: false,
        message:
          "Could not clear old TikTok customer records",
        error: deleteError.message,
      },
      { status: 500 }
    );
  }

  /*
   * Insert in batches so the request payload
   * never becomes unnecessarily large.
   */

  const batchSize = 200;

  for (
    let i = 0;
    i < customerRows.length;
    i += batchSize
  ) {
    const batch = customerRows.slice(
      i,
      i + batchSize
    );

    const { error: insertError } =
      await supabaseAdmin
        .from("tiktok_customers")
        .insert(batch);

    if (insertError) {
      return Response.json(
        {
          success: false,
          message:
            "Customer extraction worked, but saving customers failed",
          error: insertError.message,
        },
        { status: 500 }
      );
    }
  }

  return Response.json({
    success: true,
    message:
      "TikTok customer database rebuilt successfully",

    orders_read: typedOrders.length,

    unique_customers:
      customerRows.length,

    orders_without_usable_identity:
      ordersWithoutIdentity,

    cancelled_orders_excluded_from_purchase_totals:
      cancelledOrdersExcluded,
  });
}