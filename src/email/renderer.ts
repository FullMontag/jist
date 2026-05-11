import { getAnalyzerHistory, getLatestTransactions, getLatestTransportMonth, getUserDisplayName } from "@/db/results";
import { getCategoryTrends } from "@/db/credit-card";
import type { RenewalsOutput } from "@/analyzers/renewals";
import type { OpportunitiesOutput } from "@/analyzers/opportunities";

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  black:       "#000000",
  teal:        "#0D9488",
  white:       "#FFFFFF",
  surface:     "#F8FAFC",
  outline:     "#E2E8F0",
  text:        "#0F172A",
  muted:       "#64748B",
  red:         "#EF4444",
  whiteFaint:  "rgba(255,255,255,0.3)",
  whiteDim:    "rgba(255,255,255,0.5)",
  bg:          "#F1F5F9",
} as const;

const FONT  = "Arial,Helvetica,sans-serif";
const MONO  = "'Courier New',Courier,monospace";

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(amount: number | string | null | undefined, currency: string): string {
  const v = parseFloat(String(amount ?? 0)) || 0;
  const n = v % 1 === 0 ? v.toFixed(0) : v.toFixed(2);
  if (currency === "ILS") return `&#8362;${n}`;
  if (currency === "USD") return `$${n}`;
  if (currency === "EUR") return `&euro;${n}`;
  return `${esc(currency)}&nbsp;${n}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function firstNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const clean = local.replace(/[._\-+]/g, " ").trim().split(" ")[0] ?? local;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// ── Transport filter ──────────────────────────────────────────────────────────
// Services that belong in the transport panel, not the charges panel
const TRANSPORT_KEYWORDS = ["goto", "go-to", "gotoglobal", "גו-טו", "gett", "moovit", "pango", "פנגו", "rav kav", "רב-קו", "רב קו"];

function isTransportService(service: string): boolean {
  const s = service.toLowerCase();
  return TRANSPORT_KEYWORDS.some((k) => s.includes(k));
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildHeader(editionDate: string): string {
  return `
  <tr>
    <td style="padding:32px 40px;border-bottom:1px solid ${C.outline};background:${C.white};">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="width:32px;height:32px;background:${C.teal};border-radius:4px;text-align:center;vertical-align:middle;">
                  <span style="color:${C.white};font-weight:700;font-size:18px;font-family:${FONT};">j</span>
                </td>
                <td style="padding-left:12px;font-size:22px;font-weight:700;color:${C.black};letter-spacing:-0.02em;font-family:${FONT};">
                  j<span style="color:${C.teal};">i</span>st
                </td>
              </tr>
            </table>
          </td>
          <td align="right">
            <span style="display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.2em;color:${C.teal};margin-bottom:2px;font-family:${FONT};">Sunday Edition</span>
            <span style="display:block;font-size:10px;color:${C.muted};font-weight:500;font-family:${FONT};">${editionDate}</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function buildGreeting(firstName: string): string {
  return `
  <tr>
    <td style="padding:64px 40px 48px;background:${C.white};">
      <h1 style="font-size:52px;font-weight:300;letter-spacing:-0.03em;color:${C.black};margin:0 0 20px 0;line-height:1.1;font-family:${FONT};">Hi ${esc(firstName)},</h1>
      <p style="color:${C.muted};font-size:17px;line-height:1.7;max-width:420px;font-weight:400;margin:0;font-family:${FONT};">Your Sunday morning financial briefing is ready. Here&#8217;s what your inbox revealed this week.</p>
    </td>
  </tr>`;
}

function buildStatHero(
  count: number,
  largest: { amount: number | string; currency: string; service: string } | null
): string {
  const countStr = count.toString().padStart(2, "0");
  const amtHtml  = largest ? fmt(largest.amount, largest.currency) : "&#8212;";
  const subLabel = largest ? `Largest &middot; ${esc(largest.service)}` : "No charges this period";

  return `
  <tr>
    <td style="padding:0 40px 24px;background:${C.white};">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.black};">
        <tr>
          <td style="padding:40px;">
            <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:40px;">
              <tr>
                <td style="color:${C.teal};font-size:18px;padding-right:10px;">&#9632;</td>
                <td style="color:${C.whiteDim};font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.2em;font-family:${FONT};">Charges &amp; activity this period</td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="bottom">
                  <div style="font-family:${MONO};font-size:80px;font-weight:400;line-height:1;font-style:italic;letter-spacing:-0.05em;color:${C.white};">${countStr}</div>
                  <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.15em;color:${C.whiteFaint};margin-top:6px;font-weight:500;font-family:${FONT};">Transactions tracked</div>
                </td>
                <td align="right" valign="bottom">
                  <div style="font-family:${MONO};font-size:28px;font-weight:700;color:${C.teal};letter-spacing:-0.05em;">${amtHtml}</div>
                  <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.15em;color:${C.whiteFaint};margin-top:4px;font-family:${FONT};">${subLabel}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function alertBarColor(service: string, status: string, urgentList: string[]): string {
  if (urgentList.includes(service) || status === "cancelled" || status === "failed") return C.red;
  if (status === "trial-ending") return C.teal;
  return C.black;
}

function buildAlertRows(ren: RenewalsOutput | null): string {
  const renewals = ren?.renewals ?? [];
  if (renewals.length === 0) {
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="font-size:12px;color:${C.muted};font-family:${FONT};">No upcoming renewals detected.</td>
      </tr>
    </table>`;
  }

  return renewals.slice(0, 5).map((r) => {
    const barColor = alertBarColor(r.service, r.status, ren?.urgent ?? []);
    const amtPart  = r.amount != null
      ? ` &middot; <span style="font-family:${MONO};">${fmt(r.amount, r.currency)}</span>`
      : "";
    let desc = `${esc(r.renewalDate)}${amtPart}`;
    if (r.actionRequired && r.actionDescription) {
      const dangerStyle = barColor === C.red
        ? `color:${C.red};font-weight:600;`
        : "";
      desc += ` &mdash; <span style="${dangerStyle}font-family:${FONT};">${esc(r.actionDescription)}</span>`;
    }
    return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
      <tr>
        <td width="3" style="width:3px;background:${barColor};" valign="top"><div style="width:3px;min-height:44px;font-size:0;">&nbsp;</div></td>
        <td style="padding-left:16px;" valign="top">
          <div style="font-size:13px;font-weight:600;color:${C.text};margin-bottom:4px;font-family:${FONT};">${esc(r.service)}</div>
          <div style="font-size:12px;color:${C.muted};line-height:1.5;font-family:${FONT};">${desc}</div>
        </td>
      </tr>
    </table>`;
  }).join("");
}

function buildOppRows(opp: OpportunitiesOutput | null): string {
  const opps = opp?.opportunities ?? [];
  if (opps.length === 0) {
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="font-size:12px;color:${C.muted};font-family:${FONT};">No actionable opportunities found this period.</td>
      </tr>
    </table>`;
  }

  return opps.slice(0, 5).map((o) => {
    const valStr    = o.estimatedValue != null ? ` &mdash; ${fmt(o.estimatedValue, o.currency ?? "ILS")}` : "";
    const expiryStr = o.expiryDate ? `Deadline ${fmtDate(o.expiryDate)}` : esc(o.description);
    return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
      <tr>
        <td valign="top">
          <div style="font-size:13px;font-weight:600;color:${C.text};margin-bottom:3px;font-family:${FONT};">${esc(o.source)}${valStr}</div>
          <div style="font-size:11px;color:${C.muted};font-family:${FONT};">${expiryStr}</div>
        </td>
        <td align="right" valign="top" style="padding-left:16px;white-space:nowrap;">
          <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;color:${C.black};font-family:${FONT};">Act</span>
        </td>
      </tr>
    </table>`;
  }).join("");
}

function buildTwoColumnPanels(alertsHtml: string, oppsHtml: string): string {
  const panelHeaderStyle = `border-bottom:1px solid ${C.outline};padding-bottom:16px;`;
  const iconStyle        = `font-size:14px;padding-right:8px;`;
  const titleStyle       = `font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.2em;color:${C.text};font-family:${FONT};`;
  const cellStyle        = `background:${C.surface};border:1px solid rgba(226,232,240,0.5);padding:32px;vertical-align:top;width:48%;`;

  return `
  <tr>
    <td style="padding:0 40px 24px;background:${C.white};">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="${cellStyle}">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="${panelHeaderStyle}">
                <table cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="${iconStyle}">&#9888;</td>
                  <td style="${titleStyle}">Alerts &amp; Renewals</td>
                </tr></table>
              </td></tr>
              <tr><td style="padding-top:32px;">${alertsHtml}</td></tr>
            </table>
          </td>
          <td style="width:4%;font-size:0;">&nbsp;</td>
          <td style="${cellStyle}">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="${panelHeaderStyle}">
                <table cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="${iconStyle}">&#9650;</td>
                  <td style="${titleStyle}">Opportunities</td>
                </tr></table>
              </td></tr>
              <tr><td style="padding-top:32px;">${oppsHtml}</td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function buildTransportPanel(
  transport: { goto_spend: number | string; rav_kav_spend: number | string } | null
): string {
  const goto   = transport?.goto_spend   ?? 0;
  const ravKav = transport?.rav_kav_spend ?? 0;
  const numStyle = `font-family:${MONO};font-size:28px;font-weight:400;color:${C.black};letter-spacing:-0.05em;`;
  const subStyle = `font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:${C.muted};margin-top:4px;font-family:${FONT};`;

  return `
  <tr>
    <td style="padding:0 40px 24px;background:${C.white};">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.surface};border:1px solid rgba(226,232,240,0.5);">
        <tr>
          <td style="padding:32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-bottom:1px solid ${C.outline};padding-bottom:16px;">
                <table cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="font-size:14px;padding-right:8px;">&#9651;</td>
                  <td style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.2em;color:${C.text};font-family:${FONT};">Transport This Month</td>
                </tr></table>
              </td></tr>
              <tr><td style="padding-top:24px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="33%" valign="top">
                      <div style="${numStyle}">${fmt(goto, "ILS")}</div>
                      <div style="${subStyle}">GoTo / Gett</div>
                    </td>
                    <td width="33%" valign="top">
                      <div style="${numStyle}">${fmt(ravKav, "ILS")}</div>
                      <div style="${subStyle}">Moovit / Rav Kav</div>
                    </td>
                    <td width="33%" valign="top">
                      <div style="font-family:${FONT};font-size:18px;font-weight:700;color:${C.teal};letter-spacing:-0.02em;">vs &#8362;3,500</div>
                      <div style="${subStyle}">Est. car ownership saving</div>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// ── Category display config ───────────────────────────────────────────────────

const CATEGORY_GROUPS: { label: string; icon: string; match: string[] }[] = [
  { label: "Restaurants & Food",  icon: "&#127860;", match: ["restaurant", "food", "dining", "cafe", "coffee", "supermarket", "grocery"] },
  { label: "Shopping",            icon: "&#128717;", match: ["shopping", "fashion", "clothing", "retail"] },
  { label: "Health",              icon: "&#9877;",   match: ["health", "pharmacy", "medical", "clinic", "insurance", "optical"] },
  { label: "Entertainment",       icon: "&#127916;", match: ["entertainment", "cinema", "gaming", "sport", "leisure"] },
  { label: "Fuel",                icon: "&#9981;",   match: ["fuel", "gas", "petrol"] },
  { label: "Telecom",             icon: "&#128241;", match: ["telecom", "mobile", "internet", "phone", "cellular"] },
  { label: "Education",           icon: "&#128218;", match: ["education", "school", "course", "learning"] },
];

function assignCategoryGroup(category: string): string {
  const c = category.toLowerCase();
  for (const g of CATEGORY_GROUPS) {
    if (g.match.some((m) => c.includes(m))) return g.label;
  }
  return "Other";
}

function buildCategoryPanels(trends: {
  current: { category: string; total: number; count: number }[];
  previous: { category: string; total: number; count: number }[];
  currentMonth: string;
}): string {
  if (trends.current.length === 0) return "";

  // Group by display bucket
  const buckets = new Map<string, { cur: number; prev: number }>();
  const prevByCategory = new Map(trends.previous.map((r) => [r.category, r.total]));

  for (const row of trends.current) {
    const group = assignCategoryGroup(row.category);
    const existing = buckets.get(group) ?? { cur: 0, prev: 0 };
    existing.cur += Number(row.total);
    existing.prev += Number(prevByCategory.get(row.category) ?? 0);
    buckets.set(group, existing);
  }

  // Sort by current spend desc, skip tiny buckets
  const sorted = Array.from(buckets.entries())
    .filter(([, v]) => v.cur > 5)
    .sort(([, a], [, b]) => b.cur - a.cur);

  if (sorted.length === 0) return "";

  const monthLabel = trends.currentMonth
    ? new Date(trends.currentMonth + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "This month";

  const numStyle   = `font-family:${MONO};font-size:22px;font-weight:400;color:${C.black};letter-spacing:-0.04em;`;
  const labelStyle = `font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:${C.muted};margin-top:3px;font-family:${FONT};`;
  const trendUp    = `font-size:10px;font-weight:700;color:${C.red};font-family:${FONT};`;
  const trendDown  = `font-size:10px;font-weight:700;color:${C.teal};font-family:${FONT};`;
  const trendFlat  = `font-size:10px;color:${C.muted};font-family:${FONT};`;

  function trendHtml(cur: number, prev: number): string {
    if (prev === 0) return `<span style="${trendFlat}">new</span>`;
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (Math.abs(pct) < 5) return `<span style="${trendFlat}">&rarr; ${pct > 0 ? "+" : ""}${pct}%</span>`;
    if (pct > 0)  return `<span style="${trendUp}">&uarr; +${pct}%</span>`;
    return `<span style="${trendDown}">&darr; ${pct}%</span>`;
  }

  // Render in rows of 3 columns
  const cells = sorted.map(([group, v]) => {
    const cfg = CATEGORY_GROUPS.find((g) => g.label === group);
    const icon = cfg?.icon ?? "&#9632;";
    return `
    <td width="33%" valign="top" style="padding:0 8px 24px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.surface};border:1px solid rgba(226,232,240,0.5);padding:16px;">
        <tr><td>
          <div style="font-size:16px;margin-bottom:6px;">${icon}</div>
          <div style="${numStyle}">${fmt(v.cur, "ILS")}</div>
          <div style="${labelStyle}">${esc(group)}</div>
          <div style="margin-top:4px;">${trendHtml(v.cur, v.prev)}</div>
        </td></tr>
      </table>
    </td>`;
  });

  // Split into rows of 3
  const tableRows: string[] = [];
  for (let i = 0; i < cells.length; i += 3) {
    const trio = cells.slice(i, i + 3);
    while (trio.length < 3) trio.push(`<td width="33%"></td>`);
    tableRows.push(`<tr>${trio.join("")}</tr>`);
  }

  return `
  <tr>
    <td style="padding:0 40px 24px;background:${C.white};">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.white};border:1px solid rgba(226,232,240,0.5);">
        <tr>
          <td style="padding:32px 32px 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-bottom:1px solid ${C.outline};padding-bottom:16px;margin-bottom:24px;">
                <table cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="font-size:14px;padding-right:8px;">&#9650;</td>
                  <td style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.2em;color:${C.text};font-family:${FONT};">Spending by Category &middot; ${esc(monthLabel)}</td>
                </tr></table>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              ${tableRows.join("\n              ")}
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function buildChargesPanel(
  transactions: { service: string; amount: number | string; currency: string; date: string; type: string }[]
): string {
  const typeLabel: Record<string, string> = {
    charge: "subscription",
    renewal: "renewal",
    refund: "refund",
  };

  const rows = transactions.length === 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-size:12px;color:${C.muted};font-family:${FONT};">No charges recorded this period.</td>
       </tr></table>`
    : transactions.slice(0, 25).map((t) => {
        const label = typeLabel[t.type] ?? t.type;
        return `
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
          <tr>
            <td valign="top">
              <div style="font-size:13px;font-weight:600;color:${C.text};margin-bottom:3px;font-family:${FONT};">${esc(t.service)}</div>
              <div style="font-size:11px;color:${C.muted};font-family:${FONT};">${fmtDate(t.date)} &middot; ${label}</div>
            </td>
            <td align="right" valign="top" style="padding-left:16px;white-space:nowrap;">
              <span style="font-family:${MONO};font-size:11px;font-weight:700;color:${C.teal};">${fmt(t.amount, t.currency)}</span>
            </td>
          </tr>
        </table>`;
      }).join("");

  return `
  <tr>
    <td style="padding:0 40px 48px;background:${C.white};">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.surface};border:1px solid rgba(226,232,240,0.5);">
        <tr>
          <td style="padding:32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-bottom:1px solid ${C.outline};padding-bottom:16px;">
                <table cellpadding="0" cellspacing="0" border="0"><tr>
                  <td style="font-size:14px;padding-right:8px;">&#9632;</td>
                  <td style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.2em;color:${C.text};font-family:${FONT};">All Charges This Period</td>
                </tr></table>
              </td></tr>
              <tr><td style="padding-top:24px;">${rows}</td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function buildCta(): string {
  return `
  <tr>
    <td style="padding:0 40px 64px;background:${C.white};">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid ${C.black};">
        <tr>
          <td style="padding:40px;text-align:center;">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.15em;color:${C.text};margin-bottom:24px;font-family:${FONT};">Need more clarity on any of these?</div>
            <a href="#" style="display:inline-block;background:${C.black};color:${C.white};padding:20px 40px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;text-decoration:none;font-family:${FONT};">&#128172; Ask on WhatsApp</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function buildFooter(): string {
  const linkStyle = `font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.2em;color:${C.muted};text-decoration:none;font-family:${FONT};`;
  return `
  <tr>
    <td style="padding:48px 40px;border-top:1px solid ${C.outline};background:${C.white};">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top">
            <div style="font-size:18px;font-weight:700;color:${C.black};margin-bottom:4px;font-family:${FONT};">j<span style="color:${C.teal};">i</span>st Personal CFO</div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.2em;color:${C.muted};font-weight:500;font-family:${FONT};">Automated Intelligence for your Capital</div>
          </td>
          <td align="right" valign="top">
            <a href="#" style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.25em;color:${C.white};background:${C.black};padding:16px 28px;text-decoration:none;font-family:${FONT};display:inline-block;">Upgrade to Pro</a>
          </td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.outline};margin-top:48px;">
        <tr>
          <td style="padding-top:24px;" valign="top">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:28px;"><a href="#" style="${linkStyle}">Dashboard</a></td>
                <td style="padding-right:28px;"><a href="#" style="${linkStyle}">Settings</a></td>
                <td><a href="#" style="${linkStyle}">Unsubscribe</a></td>
              </tr>
            </table>
          </td>
          <td align="right" style="padding-top:24px;" valign="top">
            <span style="font-size:9px;letter-spacing:0.15em;color:rgba(100,116,139,0.5);font-weight:500;font-family:${FONT};">&copy; 2026 JIST CURATED DATA.</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function renderDigest(userId: string): Promise<string> {
  const [transactions, transport, renHistory, oppHistory, displayName, categoryTrends] = await Promise.all([
    getLatestTransactions(userId),
    getLatestTransportMonth(userId),
    getAnalyzerHistory(userId, "renewals", 1),
    getAnalyzerHistory(userId, "opportunities", 1),
    getUserDisplayName(userId),
    getCategoryTrends(userId),
  ]);

  const ren = (renHistory[0]?.raw_output as RenewalsOutput) ?? null;
  const opp = (oppHistory[0]?.raw_output as OpportunitiesOutput) ?? null;

  // Renewals belong in the Alerts panel only; charges panel shows actual spend
  const chargesOnly = transactions.filter((t) => !isTransportService(t.service) && t.type !== "renewal");

  const largest = chargesOnly.length > 0
    ? chargesOnly.reduce((a, b) => (parseFloat(String(a.amount)) >= parseFloat(String(b.amount)) ? a : b))
    : null;

  const firstName  = displayName ?? firstNameFromEmail(userId);
  const editionDate = `${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} &middot; ${esc(userId)}`;

  const rows = [
    buildHeader(editionDate),
    buildGreeting(firstName),
    buildStatHero(chargesOnly.length, largest),
    buildTwoColumnPanels(buildAlertRows(ren), buildOppRows(opp)),
    buildTransportPanel(transport),
    buildCategoryPanels(categoryTrends),
    buildChargesPanel(chargesOnly),
    buildCta(),
    buildFooter(),
  ].join("\n");

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Jist Weekly Summary</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT};-webkit-font-smoothing:antialiased;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
  <tr>
    <td align="center" style="padding:48px 20px;">
      <table width="640" cellpadding="0" cellspacing="0" border="0" style="background:${C.white};max-width:640px;">
        ${rows}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
