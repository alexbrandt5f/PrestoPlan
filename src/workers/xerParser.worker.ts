interface XERTable {
  name: string;
  fields: string[];
  rows: string[][];
}

interface ParseMessage {
  type: 'parse';
  content: string;
}

interface ParseResultMessage {
  type: 'parse_result';
  tables: XERTable[];
}

self.onmessage = (e: MessageEvent<ParseMessage>) => {
  if (e.data.type === 'parse') {
    const tables = parseXER(e.data.content);
    const result: ParseResultMessage = {
      type: 'parse_result',
      tables,
    };
    self.postMessage(result);
  }
};

function parseXER(content: string): XERTable[] {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line);
  const tables: XERTable[] = [];
  let currentTable: XERTable | null = null;

  for (const line of lines) {
    if (line.startsWith('%T\t')) {
      if (currentTable) {
        tables.push(currentTable);
      }
      const tableName = line.split('\t')[1];
      currentTable = { name: tableName, fields: [], rows: [] };
    } else if (line.startsWith('%F\t') && currentTable) {
      currentTable.fields = line.split('\t').slice(1);
    } else if (line.startsWith('%R\t') && currentTable) {
      currentTable.rows.push(line.split('\t').slice(1));
    }
  }

  if (currentTable) {
    tables.push(currentTable);
  }

  return tables;
}
