import { notFound } from "next/navigation";
import { getMatch, loadSafely } from "@/server/catalog";

/**
 * Проверка существования матча вне границы loading.tsx: если вызвать notFound() внутри
 * страницы, ответ уже начал передаваться и статус остается 200. Здесь он еще не отправлен,
 * поэтому несуществующий матч получает настоящий 404. Ошибку загрузки показывает страница.
 */
export default async function MatchLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await loadSafely(() => getMatch(id));
  if (result.ok && result.value === null) notFound();
  return children;
}
