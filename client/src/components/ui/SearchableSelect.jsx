import { useId, useMemo, useState } from 'react';

export default function SearchableSelect({
  id,
  label,
  value,
  options,
  placeholder,
  emptyMessage,
  error,
  disabled = false,
  onChange,
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const selected = options.find((option) => option.value === value);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const filteredOptions = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return search
      ? options.filter((option) => option.label.toLocaleLowerCase().includes(search))
      : options;
  }, [options, query]);

  const select = (option) => {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index < 0 ? 0 : index + 1, filteredOptions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? filteredOptions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && open && filteredOptions[activeIndex]) {
      event.preventDefault();
      select(filteredOptions[activeIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setQuery(selected?.label || '');
    }
  };

  return (
    <div className="field phase8-search-select">
      <label className="field__label" htmlFor={inputId}>{label}</label>
      <input
        aria-activedescendant={open && filteredOptions[activeIndex]
          ? `${inputId}-option-${activeIndex}`
          : undefined}
        aria-autocomplete="list"
        aria-controls={`${inputId}-options`}
        aria-expanded={open}
        aria-invalid={Boolean(error)}
        autoComplete="off"
        className="field__control"
        disabled={disabled}
        id={inputId}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
          if (value) onChange('');
        }}
        onFocus={() => {
          setQuery('');
          setActiveIndex(-1);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        role="combobox"
        value={open ? query : selected?.label || ''}
      />
      {open && (
        <div className="phase8-search-select__options" id={`${inputId}-options`} role="listbox">
          {filteredOptions.length ? filteredOptions.map((option, index) => (
            <button
              aria-selected={option.value === value}
              className="phase8-search-select__option"
              id={`${inputId}-option-${index}`}
              key={option.value}
              onClick={() => select(option)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              {option.label}
            </button>
          )) : <p className="phase8-search-select__empty">{emptyMessage}</p>}
        </div>
      )}
      {error && <p className="field__error" role="alert">{error}</p>}
    </div>
  );
}
