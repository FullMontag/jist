import type { AnalyzerResult } from "@/analyzers/types";
import type { SubscriptionOutput } from "@/analyzers/subscriptions";
import type { RenewalsOutput } from "@/analyzers/renewals";
import type { OpportunitiesOutput } from "@/analyzers/opportunities";

function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function renderSubscriptions(result: AnalyzerResult<SubscriptionOutput>): string {
  const { subscriptions, totalSpend, summary } = result.output;
  if (subscriptions.length === 0) return "";

  const rows = subscriptions
    .map(
      (s) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${s.service}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">${formatCurrency(s.amount, s.currency)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#666;">${s.billingCycle}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#666;">${formatDate(s.date)}</td>
      </tr>`
    )
    .join("");

  return `
    <div style="margin-bottom:32px;">
      <h2 style="color:#1a1a1a;font-size:18px;margin-bottom:8px;">💳 Subscriptions & Billing</h2>
      <p style="color:#666;margin-bottom:16px;">${summary}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f8f8f8;">
            <th style="padding:8px 12px;text-align:left;font-weight:600;">Service</th>
            <th style="padding:8px 12px;text-align:right;font-weight:600;">Amount</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;">Cycle</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;">Date</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="background:#f8f8f8;font-weight:600;">
            <td style="padding:8px 12px;">Total</td>
            <td style="padding:8px 12px;text-align:right;">${formatCurrency(totalSpend)}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

function renderRenewals(result: AnalyzerResult<RenewalsOutput>): string {
  const { renewals, urgent, summary } = result.output;
  if (renewals.length === 0) return "";

  const urgentBanner =
    urgent.length > 0
      ? `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:12px 16px;margin-bottom:16px;font-size:14px;">
          ⚠️ <strong>Action required:</strong> ${urgent.join(", ")}
         </div>`
      : "";

  const items = renewals
    .map((r) => {
      const badge = {
        upcoming: `<span style="background:#e3f2fd;color:#1565c0;padding:2px 8px;border-radius:12px;font-size:12px;">Upcoming</span>`,
        cancelled: `<span style="background:#fce4ec;color:#c62828;padding:2px 8px;border-radius:12px;font-size:12px;">Cancelled</span>`,
        failed: `<span style="background:#ffebee;color:#b71c1c;padding:2px 8px;border-radius:12px;font-size:12px;">Failed</span>`,
        "trial-ending": `<span style="background:#fff8e1;color:#f57f17;padding:2px 8px;border-radius:12px;font-size:12px;">Trial Ending</span>`,
      }[r.status];

      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${r.service}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${badge}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#666;">${formatDate(r.renewalDate)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${r.amount ? formatCurrency(r.amount, r.currency) : "—"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px;">${r.actionDescription ?? ""}</td>
        </tr>`;
    })
    .join("");

  return `
    <div style="margin-bottom:32px;">
      <h2 style="color:#1a1a1a;font-size:18px;margin-bottom:8px;">🔄 Renewals & Expirations</h2>
      <p style="color:#666;margin-bottom:16px;">${summary}</p>
      ${urgentBanner}
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f8f8f8;">
            <th style="padding:8px 12px;text-align:left;font-weight:600;">Service</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;">Status</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;">Date</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;">Amount</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;">Notes</th>
          </tr>
        </thead>
        <tbody>${items}</tbody>
      </table>
    </div>`;
}

function renderOpportunities(result: AnalyzerResult<OpportunitiesOutput>): string {
  const { opportunities, totalPotentialValue, summary } = result.output;
  if (opportunities.length === 0) return "";

  const items = opportunities
    .map(
      (o) => `
      <div style="border:1px solid #e8f5e9;border-radius:8px;padding:14px 16px;margin-bottom:10px;background:#fafffe;">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
          <strong style="font-size:15px;">${o.title}</strong>
          ${o.estimatedValue ? `<span style="color:#2e7d32;font-weight:600;">${formatCurrency(o.estimatedValue)}</span>` : ""}
        </div>
        <div style="color:#666;font-size:13px;margin-bottom:6px;">${o.source} · ${o.type}</div>
        <div style="font-size:14px;color:#333;">${o.description}</div>
        ${o.expiryDate ? `<div style="font-size:12px;color:#999;margin-top:6px;">Expires ${formatDate(o.expiryDate)}</div>` : ""}
      </div>`
    )
    .join("");

  return `
    <div style="margin-bottom:32px;">
      <h2 style="color:#1a1a1a;font-size:18px;margin-bottom:8px;">💰 Financial Opportunities</h2>
      <p style="color:#666;margin-bottom:16px;">${summary}</p>
      <p style="font-size:13px;color:#2e7d32;margin-bottom:16px;">Potential value: <strong>${formatCurrency(totalPotentialValue)}</strong></p>
      ${items}
    </div>`;
}

export interface DigestData {
  userEmail: string;
  weekOf: Date;
  emailsFetched: number;
  results: AnalyzerResult[];
}

export function renderDigestHtml(data: DigestData): string {
  const { userEmail, weekOf, emailsFetched, results } = data;

  const weekStr = weekOf.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const sections = results
    .map((result) => {
      switch (result.analyzerId) {
        case "subscriptions":
          return renderSubscriptions(result as AnalyzerResult<SubscriptionOutput>);
        case "renewals":
          return renderRenewals(result as AnalyzerResult<RenewalsOutput>);
        case "opportunities":
          return renderOpportunities(result as AnalyzerResult<OpportunitiesOutput>);
        default:
          return "";
      }
    })
    .join("");

  const noResults =
    results.length === 0
      ? `<p style="color:#666;text-align:center;padding:40px 0;">No financial activity detected this week.</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jist — Weekly Financial Digest</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px;">

    <!-- Header -->
    <div style="background:#1a1a1a;border-radius:12px;padding:28px 32px;margin-bottom:24px;color:#fff;">
      <div style="font-size:22px;font-weight:700;letter-spacing:-0.5px;">Jist</div>
      <div style="font-size:13px;color:#999;margin-top:4px;">Your personal CFO</div>
      <div style="margin-top:16px;font-size:15px;color:#ccc;">
        Week of <strong style="color:#fff;">${weekStr}</strong>
        &nbsp;·&nbsp; ${emailsFetched} emails scanned
      </div>
    </div>

    <!-- Sections -->
    <div style="background:#fff;border-radius:12px;padding:28px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      ${sections || noResults}
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:20px;font-size:12px;color:#999;">
      Sent to ${userEmail} · <a href="#" style="color:#999;">Unsubscribe</a>
    </div>

  </div>
</body>
</html>`;
}
