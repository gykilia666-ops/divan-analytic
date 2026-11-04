import type { Metadata } from "next";
import { z } from "zod";
import { KickoffTime } from "@/components/matches/kickoff-time";
import { ensureUserInitialized } from "@/server/auth/ensure-user";
import { requireUser } from "@/server/auth/session";
import { createClient } from "@/server/db/supabase-server";

export const metadata: Metadata = { title: "Кошелёк" };
export const dynamic = "force-dynamic";

const KINDS = [
  "INITIAL_CREDIT",
  "STAKE_DEBIT",
  "WIN_CREDIT",
  "VOID_REFUND",
  "ADMIN_ADJUSTMENT",
] as const;

const KIND_LABEL: Record<(typeof KINDS)[number], string> = {
  INITIAL_CREDIT: "Стартовые монеты",
  STAKE_DEBIT: "Списание за прогноз",
  WIN_CREDIT: "Выигрыш",
  VOID_REFUND: "Возврат ставки",
  ADMIN_ADJUSTMENT: "Корректировка",
};

const walletSchema = z.object({ balance: z.number() });
const entriesSchema = z.array(
  z.object({
    id: z.string(),
    kind: z.enum(KINDS),
    amount: z.number(),
    created_at: z.string(),
  }),
);

type WalletEntry = z.infer<typeof entriesSchema>[number];
interface WalletData {
  balance: number;
  entries: WalletEntry[];
}

const numberFormat = new Intl.NumberFormat("ru-RU");

function signed(amount: number): string {
  const abs = numberFormat.format(Math.abs(amount));
  return amount > 0 ? `+${abs}` : `−${abs}`;
}

/** Загрузка данных вынесена из JSX: ошибки запросов ловим здесь, а не вокруг разметки. */
async function loadWallet(userId: string): Promise<WalletData | null> {
  try {
    const supabase = await createClient();

    let walletRow = await supabase
      .from("wallets")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (walletRow.error) return null;

    if (!walletRow.data) {
      // Вход был, а инициализация не завершилась (например, сбой БД): безопасно повторяем.
      await ensureUserInitialized(supabase);
      walletRow = await supabase
        .from("wallets")
        .select("balance")
        .eq("user_id", userId)
        .maybeSingle();
      if (walletRow.error || !walletRow.data) return null;
    }
    const wallet = walletSchema.parse(walletRow.data);

    const entriesRes = await supabase
      .from("wallet_entries")
      .select("id, kind, amount, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(20);
    if (entriesRes.error) return null;

    return { balance: wallet.balance, entries: entriesSchema.parse(entriesRes.data) };
  } catch {
    return null;
  }
}

export default async function WalletPage() {
  const user = await requireUser("/my/wallet");
  const data = await loadWallet(user.id);

  if (!data) {
    return (
      <div role="alert" className="space-y-2">
        <h1 className="text-2xl font-bold">Кошелёк</h1>
        <p>
          Не удалось загрузить кошелёк. Баланс не показываем, чтобы не вводить в заблуждение.
          Попробуйте позже.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Кошелёк</h1>
      <p className="text-lg">
        Баланс: <strong data-testid="wallet-balance">{numberFormat.format(data.balance)}</strong>{" "}
        монет
      </p>
      <section aria-labelledby="journal">
        <h2 id="journal" className="mb-2 text-xl font-semibold">
          Журнал операций
        </h2>
        {data.entries.length === 0 ? (
          <p>Операций пока нет.</p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border bg-surface">
            {data.entries.map((entry) => (
              <li
                key={entry.id}
                data-testid="wallet-entry"
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <span>{KIND_LABEL[entry.kind]}</span>
                <span className="text-sm text-muted">
                  <KickoffTime iso={entry.created_at} />
                </span>
                <strong>{signed(entry.amount)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-sm text-muted">Монеты ненастоящие и не имеют денежной стоимости.</p>
    </div>
  );
}
