import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/** A password field with an eye button to show or hide what's been typed. Takes the same props as an <input>. */
export function PasswordInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative block">
      <input {...props} type={show ? 'text' : 'password'} className={`${className} !pr-12`} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} title={show ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-1 my-auto grid h-10 w-10 place-items-center rounded-lg text-text-muted hover:text-text focus-ring" data-testid="pw-toggle">
        {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </span>
  )
}
