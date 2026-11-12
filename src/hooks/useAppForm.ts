import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useRef } from 'react';
import {
  useForm,
  type FieldPath,
  type FieldValues,
  type UseFormHandleSubmit,
  type UseFormProps,
  type UseFormSetError,
} from 'react-hook-form';
import type { z } from 'zod';

export function useAppForm<T extends FieldValues>({
  schema,
  ...options
}: UseFormProps<T> & { schema: z.ZodType<T, T> }) {
  const form = useForm<T>({ ...options, resolver: zodResolver(schema), shouldFocusError: false });
  const formRef = useRef<HTMLFormElement>(null);
  const { getFieldState, setFocus, setError: setFieldError } = form;

  const focusFirstError = useCallback(() => {
    const fields = formRef.current?.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('input, select, textarea');
    const first = Array.from(fields ?? []).find(
      (field) => getFieldState(field.name as FieldPath<T>).invalid,
    );
    if (first) {
      first.scrollIntoView?.({ block: 'center' });
      setFocus(first.name as FieldPath<T>);
    }
  }, [getFieldState, setFocus]);

  const setError: UseFormSetError<T> = useCallback(
    (name, error) => {
      setFieldError(name, error);
      // A server error arrives with the end of a request; the store tells React on the next animation frame that the
      // fields are enabled again. A disabled field cannot take focus, so focus after that frame.
      requestAnimationFrame(focusFirstError);
    },
    [setFieldError, focusFirstError],
  );

  const handleSubmit: UseFormHandleSubmit<T> = (onValid, onInvalid) =>
    form.handleSubmit(onValid, (errors, event) => {
      focusFirstError();
      return onInvalid?.(errors, event);
    });

  // MUI TextField's ref points to its wrapper; RHF needs the actual input.
  const registerInput = (name: FieldPath<T>) => {
    const { ref, ...field } = form.register(name);
    return { ...field, inputRef: ref };
  };

  return { ...form, formRef, registerInput, handleSubmit, setError };
}
