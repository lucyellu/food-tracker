const PREFIX = "Food Tracker - ";
const NEXT_SERVER_TITLE = /^next-server\b/i;

function prefixTitle() {
  const title = process.title || "";

  if (title.startsWith(PREFIX)) {
    return;
  }

  if (NEXT_SERVER_TITLE.test(title)) {
    process.title = `${PREFIX}${title}`;
  }
}

process.title = `${PREFIX}next-server`;

const titleInterval = setInterval(prefixTitle, 250);
titleInterval.unref?.();
