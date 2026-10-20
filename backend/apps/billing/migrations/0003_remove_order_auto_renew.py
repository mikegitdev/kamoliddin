# Auto-renewal retired: campaigns are paid once per order.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0002_order_auto_renew_order_interval_end_at_and_more'),
        ('renewals', '0004_delete_renewals'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='order',
            name='auto_renew',
        ),
    ]
