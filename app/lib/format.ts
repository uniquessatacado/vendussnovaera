export const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const shortDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return shortDate.format(new Date(`${value.includes("T") ? value : `${value}T12:00:00`}`));
}

export function formatDateTime(value: string) {
  return dateTime.format(new Date(value));
}

export function normalizeWhatsapp(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits;
}

export function whatsappUrl(value: string) {
  return `https://wa.me/${normalizeWhatsapp(value)}`;
}

export function caseCode(caseNumber: number) {
  return `NEV-${String(caseNumber).padStart(4, "0")}`;
}
