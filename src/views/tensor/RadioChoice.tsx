import { useId } from 'react';

export interface RadioOption<T> {
  value: T;
  label: string;
}

export interface RadioChoiceProps<T> {
  label: string;
  options: readonly RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Native Radio-Gruppe (`radiogroup`), per Pfeiltasten bedienbar (CON-0018 SU-05). */
export function RadioChoice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: RadioChoiceProps<T>) {
  const name = useId();
  return (
    <div className="radio-choice" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={String(option.value)} className="chip">
          <input
            type="radio"
            name={name}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
