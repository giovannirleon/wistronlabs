function formatDateHumanReadable(rawDate) {
  if (!rawDate) return "";

  const utcISO = rawDate.replace(" ", "T") + ":00Z";
  const date = new Date(utcISO);

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";

  hours = hours % 12;
  hours = hours === 0 ? 12 : hours;
  const hoursStr = String(hours).padStart(2, "0");

  return `${month}/${day}/${year}, ${hoursStr}:${minutes}:${seconds} ${ampm}`;
}
