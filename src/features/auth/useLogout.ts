import { useNavigate } from 'react-router';
import { clearSession } from '../../graphql/session';
import { useLogoutMutation } from './authApi';

/** Logs out locally at once; the server call that revokes the cookie is not awaited. */
export function useLogout(): () => void {
  const [logout] = useLogoutMutation();
  const navigate = useNavigate();

  return () => {
    clearSession();
    void logout();
    void navigate('/login', { replace: true });
  };
}
