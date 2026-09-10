import copy
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import event_finance as finance


def test_requested_example_and_free_carers():
    result = finance.calculate(90, 35, 12, 900, 4)
    assert result == dict(subtotal=3150, discount=378, gross=2772, net=2253.66,
                         vat=518.34, costs=900, profit=1872, paid_people=35,
                         free_carers=4, attendees=39)
    assert finance.calculate(90,35,12,900,0)['gross'] == result['gross']

@pytest.mark.parametrize('price,people,discount,costs,carers', [
    (-1,35,12,0,0), (90,1.5,0,0,0), (90,35,101,0,0),
    (90,35,0,-1,0), (90,35,0,0,-1), ('NaN',1,0,0,0),
    ('1.001',1,0,0,0), (1000000,100000,0,0,0), (90,35,0,0,1.5)])
def test_invalid_inputs(price,people,discount,costs,carers):
    with pytest.raises(ValueError): finance.calculate(price,people,discount,costs,carers)


def test_full_discount_and_half_cent_rounding():
    assert finance.calculate(90,35,100,900)['profit'] == -900
    assert finance.calculate('0,05',1,10)['gross'] == .04
    assert finance.calculate(0,0,0)['gross'] == 0


def test_server_recalculates_untrusted_totals_and_preserves_business_data():
    doc = dict(pricing_mode=finance.MODE, price_per_person=90, paying_people=35,
        free_carers=4, discount_pct=12, price_total=1, revenue=999999,
        costs=[dict(label='Materiały',amount=900)], shifts=[dict(staff_id='a',hours=2)],
        client_name='Szkoła', dinner_items={'menu': 2}, external_id='uid-1',
        org={'checklist': ['a']}, automation={'sent': True})
    original = copy.deepcopy(doc)
    result = finance.apply(doc)
    assert result['price_total'] == result['price_after_discount'] == 2772
    assert result['revenue'] == 2772
    assert result['revenue_net'] == 2253.66
    assert result['people'] == 39
    for field in ['costs','shifts','client_name','dinner_items','external_id','org','automation']:
        assert result[field] == original[field]
    assert finance.apply(copy.deepcopy(result)) == result
    updated = finance.apply({'price_per_person':100}, result)
    assert updated['price_total'] == 3080


def test_legacy_record_is_not_migrated_implicitly():
    old = dict(price_total=1234, revenue=950, discount_pct=7, costs=[])
    payload = {'name':'Nowa nazwa'}
    assert finance.apply(payload.copy(),old) == payload
    assert finance.apply(old.copy()) == old


def test_invalid_cost_is_rejected():
    with pytest.raises(ValueError):
        finance.apply(dict(pricing_mode=finance.MODE,price_per_person=90,paying_people=35,costs=[{'amount':-1}]))
