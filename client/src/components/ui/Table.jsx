import { useTranslation } from 'react-i18next';

export default function Table({ columns, rows, rowKey = 'id' }) {
  const { t } = useTranslation();
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>{columns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr key={row[rowKey] ?? index}>
              {columns.map((column) => (
                <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
              ))}
            </tr>
          )) : (
            <tr><td className="table-empty" colSpan={columns.length}>{t('emptyTable')}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
