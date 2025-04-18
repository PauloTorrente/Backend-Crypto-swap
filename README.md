# Currency Exchange Rate Management

This project manages currency exchange rates, offering functionalities to add, update, fetch, and delete exchange rates. It includes validation for currency data, automatic calculations of spread and mid-rate, and business rules for rate management.

## Features

- **Add Currency:** Create new currency entries with the required details (currency code, name, rates).
- **Update Currency:** Modify the buy and sell rates for existing currencies.
- **Fetch Rates:** Retrieve all exchange rates or a specific rate by currency code.
- **Delete Currency:** Remove a currency from the database (with restrictions on base currency).
- **Spread Calculation:** Automatically calculate the spread between buy and sell rates, with a business rule to limit it to a maximum of 10%.
- **Mid-rate Calculation:** Compute the average between buy and sell rates for each currency.

