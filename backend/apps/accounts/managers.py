from django.contrib.auth.base_user import BaseUserManager


class UserManager(BaseUserManager):
    """Phone-first user manager. Advertisers never set passwords (OTP only);
    staff/superusers may set one for Django admin sign-in."""

    use_in_migrations = True

    def _create(self, phone_e164: str, password: str | None, **extra):
        if not phone_e164:
            raise ValueError("phone_e164 is required")
        user = self.model(phone_e164=phone_e164, **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_user(self, phone_e164: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create(phone_e164, password, **extra)

    def create_superuser(self, phone_e164: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        if extra["is_staff"] is not True or extra["is_superuser"] is not True:
            raise ValueError("Superuser must have is_staff=True and is_superuser=True")
        if not password:
            raise ValueError("Superuser requires a password (Django admin sign-in)")
        return self._create(phone_e164, password, **extra)
