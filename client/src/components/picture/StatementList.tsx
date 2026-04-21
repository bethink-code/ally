import { useMemo, useState } from "react";
import { formatDate, formatMoney } from "@/lib/formatters";
import type { Statement } from "@shared/schema";

type ExtractionShape = {
  accountHolderName: string | null;
  accountNumberMasked: string | null;
  bankName: string | null;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  transactions: { date: string; description: string; amount: number; direction: "debit" | "credit" }[];
  notes?: string;
};

export function StatementList({ statements }: { statements: Statement[] }) {
  if (statements.length === 0) return null;
  return (
    <div className="space-y-4">
      <StatementsSummary statements={statements} />
      <StatementsPanel statements={statements} />
    </div>
  );
}

function StatementsSummary({ statements }: { statements: Statement[] }) {
  const summary = useMemo(() => {
    const extracted = statements.filter((s) => s.status === "extracted");
    let totalTransactions = 0;
    let earliest: string | null = null;
    let latest: string | null = null;
    const banks = new Set<string>();
    for (const s of extracted) {
      const r = s.extractionResult as ExtractionShape | null;
      if (!r) continue;
      totalTransactions += r.transactions?.length ?? 0;
      if (r.bankName) banks.add(r.bankName);
      if (r.statementPeriodStart && (!earliest || r.statementPeriodStart < earliest)) earliest = r.statementPeriodStart;
      if (r.statementPeriodEnd && (!latest || r.statementPeriodEnd > latest)) latest = r.statementPeriodEnd;
    }
    return { count: extracted.length, totalTransactions, earliest, latest, banks: Array.from(banks) };
  }, [statements]);

  if (summary.count === 0) return null;

  const range =
    summary.earliest && summary.latest ? `${summary.earliest} → ${summary.latest}` : null;

  return (
    <div className="rounded-md border border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground">
      {summary.count} statement{summary.count === 1 ? "" : "s"}
      {range && <> · {range}</>}
      {summary.totalTransactions > 0 && <> · {summary.totalTransactions} transactions</>}
      {summary.banks.length > 0 && <> · {summary.banks.join(", ")}</>}
    </div>
  );
}

function StatementsPanel({ statements }: { statements: Statement[] }) {
  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {statements.map((s) => (
        <StatementRow key={s.id} statement={s} />
      ))}
    </div>
  );
}

function StatementRow({ statement }: { statement: Statement }) {
  const [open, setOpen] = useState(false);
  const result = statement.extractionResult as ExtractionShape | null;

  const summary = useMemo(() => {
    if (!result) return null;
    const txCount = result.transactions?.length ?? 0;
    const debits = result.transactions?.filter((t) => t.direction === "debit").length ?? 0;
    const credits = result.transactions?.filter((t) => t.direction === "credit").length ?? 0;
    return { txCount, debits, credits };
  }, [result]);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40"
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{statement.filename}</div>
          <div className="text-xs text-muted-foreground">
            {formatDate(statement.createdAt)}
            {result?.bankName && <> · {result.bankName}</>}
            {result?.statementPeriodStart && result?.statementPeriodEnd && (
              <> · {result.statementPeriodStart} → {result.statementPeriodEnd}</>
            )}
            {summary && <> · {summary.txCount} transactions</>}
          </div>
        </div>
        <StatusBadge status={statement.status} />
      </button>

      {open && result && (
        <div className="border-t border-border bg-muted/20 px-4 py-4 space-y-4 text-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Account holder" value={result.accountHolderName ?? "—"} />
            <Field label="Account" value={result.accountNumberMasked ?? "—"} />
            <Field label="Opening" value={formatBalance(result.openingBalance)} />
            <Field label="Closing" value={formatBalance(result.closingBalance)} />
          </div>
          {result.notes && (
            <div className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-xs text-amber-900">
              {result.notes}
            </div>
          )}
          {result.transactions && result.transactions.length > 0 && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                First 10 transactions
              </div>
              <div className="divide-y divide-border rounded-md border border-border bg-card">
                {result.transactions.slice(0, 10).map((t, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate">{t.description}</div>
                      <div className="text-xs text-muted-foreground">{t.date}</div>
                    </div>
                    <div className={t.direction === "credit" ? "text-primary" : "text-foreground"}>
                      {t.direction === "debit" ? "−" : "+"}
                      {formatMoney(t.amount)}
                    </div>
                  </div>
                ))}
              </div>
              {result.transactions.length > 10 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  …and {result.transactions.length - 10} more.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    extracting: "text-muted-foreground",
    extracted: "text-primary",
    failed: "text-destructive",
  };
  return <span className={`ml-3 text-xs ${map[status] ?? "text-muted-foreground"}`}>{status}</span>;
}

function formatBalance(n: number | null | undefined): string {
  if (n == null) return "—";
  return formatMoney(n);
}
