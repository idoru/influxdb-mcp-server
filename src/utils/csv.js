// Parse RFC 4180 CSV text into rows of fields. Handles quoted fields
// (including embedded commas, quotes and newlines) and LF or CRLF line endings.
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

const isBlankRow = (row) => row.every((field) => field.trim() === "");

// Parse an InfluxDB Flux CSV response into tables of { headers, records }.
// Annotation rows (starting with '#') are skipped, and each table that follows
// a blank line or an annotation block starts with its own header row.
export function parseFluxCsv(text) {
  const tables = [];
  let current = null;

  for (const row of parseCsvRows(text)) {
    if (isBlankRow(row) || row[0].startsWith("#")) {
      current = null;
      continue;
    }

    if (!current) {
      current = { headers: row, records: [] };
      tables.push(current);
      continue;
    }

    const record = {};
    current.headers.forEach((header, index) => {
      record[header] = row[index];
    });
    current.records.push(record);
  }

  return tables;
}
