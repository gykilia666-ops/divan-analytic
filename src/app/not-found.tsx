import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Страница не найдена</h1>
      <p>Такой страницы нет. Возможно, она в офсайде.</p>
      <Link href="/" className="underline">
        На главную
      </Link>
    </div>
  );
}
