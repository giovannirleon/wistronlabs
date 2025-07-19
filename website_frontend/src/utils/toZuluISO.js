export default function toZuluISO(localDate, localTime, utcOffset) {
  // Parse YYYY-MM-DD
  const [year, month, day] = localDate.split("-").map(Number);

  // Parse hh:mm:ss AM/PM
  let [timePart, meridiem] = localTime.split(" ");
  let [hour, minute, second] = timePart.split(":").map(Number);

  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  // This is local time at given UTC offset
  // so we need to compute UTC by subtracting the offset
  const localMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  const utcMillis = localMillis - utcOffset * 60 * 60 * 1000;

  return new Date(utcMillis).toISOString();
}
