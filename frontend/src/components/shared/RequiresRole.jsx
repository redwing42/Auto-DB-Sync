import { useAuth } from '../../context/AuthContext';
import { ROLES } from '../../constants';

const ROLE_HIERARCHY = {
    [ROLES.OPERATOR]: 1,
    [ROLES.REVIEWER]: 2,
    [ROLES.SDE]: 3,
    [ROLES.ADMIN]: 4
};

export default function RequiresRole({ role, children, fallback = null }) {
    const { user } = useAuth();

    if (!user) return fallback;

    const userLevel = ROLE_HIERARCHY[user.role?.toLowerCase()] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[role] ?? 99;

    if (userLevel >= requiredLevel) return children;
    return fallback;
}
