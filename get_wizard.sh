sed -n '1750,1950p' src/components/EnterpriseSandbox.tsx > temp_wizard.txt
grep -n "Choose Subscription Package" temp_wizard.txt -B 5 -A 40
