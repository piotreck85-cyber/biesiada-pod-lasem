"""Server-authoritative per-person event prices. Legacy records remain unchanged."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

MODE = 'per_person_v1'
INPUT_FIELDS = {'pricing_mode', 'price_per_person', 'paying_people', 'free_carers'}
PRICE_FIELDS = INPUT_FIELDS | {'pricing_subtotal', 'pricing_discount_amount', 'vat_rate', 'vat_amount', 'revenue_net'}
MONEY = Decimal('0.01')


def number(value, label, maximum, integer=False):
    try:
        if isinstance(value, bool):
            raise ValueError()
        text = str(value if value is not None else 0).replace(' ', '').replace(',', '.') or '0'
        value = Decimal(text)
        if not value.is_finite() or value < 0 or value > maximum:
            raise ValueError()
        quantum = Decimal('1') if integer else MONEY
        if value != value.quantize(quantum):
            raise ValueError()
        return value
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError(f'Nieprawidłowe pole: {label}.') from None


def calculate(price, people, discount, costs=0, carers=0):
    unit = number(price, 'cena za osobę', 1000000)
    people = number(people, 'liczba płatnych osób', 100000, True)
    carers = number(carers, 'opiekunowie gratis', 100000, True)
    discount = number(discount, 'rabat %', 100)
    costs = number(costs, 'koszty wydarzenia', 100000000)
    subtotal = unit * people
    if subtotal > 100000000:
        raise ValueError('Wartość wydarzenia jest zbyt duża.')
    reduction = (subtotal * discount / 100).quantize(MONEY, rounding=ROUND_HALF_UP)
    gross = subtotal - reduction
    net = (gross / Decimal('1.23')).quantize(MONEY, rounding=ROUND_HALF_UP)
    return {'subtotal': float(subtotal), 'discount': float(reduction), 'gross': float(gross),
            'net': float(net), 'vat': float(gross - net), 'costs': float(costs), 'profit': float(gross - costs),
            'paid_people': int(people), 'free_carers': int(carers), 'attendees': int(people + carers)}


def apply(doc, previous=None):
    """Only explicit adoption activates new pricing; never rewrite legacy totals."""
    previous = previous or {}
    merged = {**previous, **doc}
    if merged.get('pricing_mode') != MODE:
        return doc
    for field in ('price_per_person', 'paying_people'):
        if field not in merged:
            raise ValueError('Uzupełnij cenę za osobę i liczbę płatnych osób.')
    result = calculate(merged['price_per_person'], merged['paying_people'], merged.get('discount_pct', 0), carers=merged.get('free_carers', 0))
    # All existing business consumers use the final gross price_total for receivables
    # and gross revenue for the requested gross cash result. No double discount on price_total.
    doc.update(pricing_mode=MODE, price_per_person=float(number(merged['price_per_person'], 'cena za osobę', 1000000)),
               paying_people=result['paid_people'], free_carers=result['free_carers'], people=result['attendees'],
               discount_pct=float(number(merged.get('discount_pct', 0), 'rabat', 100)),
               pricing_subtotal=result['subtotal'], pricing_discount_amount=result['discount'],
               price_total=result['gross'], price_after_discount=result['gross'],
               vat_rate=23, vat_amount=result['vat'], revenue_net=result['net'], revenue=result['gross'])
    for cost in merged.get('costs') or []:
        number(cost.get('amount'), 'koszt', 100000000)
    return doc
