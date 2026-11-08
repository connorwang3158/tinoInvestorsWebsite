// Meetings are every Wednesday at lunch (12:45 to 1:25 PM on the regular bell schedule).
// No meetings on days without school or during finals and AP exam weeks. Sources:
//   No-school days: https://www.fuhsd.org/about-us/general-information/calendar
//   Finals weeks:   https://chs.fuhsd.org/about-us/general-information/bell-schedules
//   AP exam weeks:  https://apstudents.collegeboard.org/exam-dates
// Use "YYYY-MM-DD" for one day or ["first", "last"] for a stretch of days. Add the next school year's dates each summer.
const MEETING_DAY = 3; // 0 = Sunday ... 3 = Wednesday
const SKIP_DATES = [
  // 2026-27
  "2026-09-07", // Labor Day
  "2026-10-12", // Teacher non-duty day
  "2026-11-11", // Veterans Day
  ["2026-11-25", "2026-11-27"], // Thanksgiving break
  ["2026-12-14", "2026-12-18"], // First semester finals
  ["2026-12-21", "2027-01-01"], // Mid-year break
  "2027-01-18", // Martin Luther King Day
  ["2027-02-15", "2027-02-19"], // Presidents' week
  "2027-03-15", // Non-duty day
  ["2027-04-12", "2027-04-16"], // Spring break
  ["2027-05-03", "2027-05-14"], // AP exams
  ["2027-05-24", "2027-06-04"], // Second semester finals (includes Memorial Day, May 31)
  ["2027-06-05", "2027-08-15"], // Summer (last day June 3, back August 16)
  // 2027-28 (finals and AP weeks not posted yet)
  "2027-09-06", // Labor Day
  "2027-10-11", // Teacher non-duty day
  "2027-11-11", // Veterans Day
  ["2027-11-24", "2027-11-26"], // Thanksgiving break
  ["2027-12-20", "2027-12-31"], // Mid-year break
  "2028-01-17", // Martin Luther King Day
  ["2028-02-21", "2028-02-25"], // Presidents' week
  "2028-03-13", // Non-duty day
  ["2028-04-10", "2028-04-14"], // Spring break
  "2028-05-29", // Memorial Day
];

function isSkipped(day) {
  return SKIP_DATES.some((entry) =>
    Array.isArray(entry) ? day >= entry[0] && day <= entry[1] : day === entry
  );
}

function isoDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const nextMeetingSlots = document.querySelectorAll("[data-next-meeting]");
if (nextMeetingSlots.length) {
  const now = new Date();
  const date = new Date(now);
  // A Wednesday meeting still counts as "next" until lunch ends at 1:25 PM
  if (date.getHours() * 60 + date.getMinutes() >= 13 * 60 + 25) date.setDate(date.getDate() + 1);
  while (date.getDay() !== MEETING_DAY || isSkipped(isoDate(date))) {
    date.setDate(date.getDate() + 1);
  }
  const label = isoDate(date) === isoDate(now)
    ? "Today"
    : date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  nextMeetingSlots.forEach((slot) => {
    slot.textContent = `${label} at lunch`;
  });
}

// Keep the address bar clean: in-page links scroll to their section without adding "#about" to the URL
document.querySelectorAll('a[href^="#"]:not(.skip-link)').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.getElementById(link.getAttribute("href").slice(1));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth" });
  });
});

// Arriving from another page through "./#about": scroll there once everything has loaded, then drop the "#about"
if (location.hash) {
  window.addEventListener("load", () => {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
    history.replaceState(null, "", location.pathname + location.search);
  });
}
