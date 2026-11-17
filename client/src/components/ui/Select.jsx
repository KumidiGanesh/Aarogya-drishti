export default function Select({ label, id, children, ...props }) {
  return (
    <label className="field" htmlFor={id}>
      {label && <span className="field__label">{label}</span>}
      <select className="field__control" id={id} {...props}>
        {children}
      </select>
    </label>
  );
}
