# Auto-renewal retired: campaigns are paid once per order.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('renewals', '0003_alter_renewalagreement_status_and_more'),
    ]

    operations = [
        migrations.DeleteModel(
            name='RenewalAttempt',
        ),
        migrations.DeleteModel(
            name='RenewalAgreement',
        ),
    ]
