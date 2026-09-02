from setuptools import setup, find_packages

with open("requirements.txt") as f:
	install_requires = f.read().strip().split("\n")

setup(
	name="apparel_erp",
	version="0.0.1",
	description="Apparel PLM: Styles, Colour x Size matrix, auto SKU + BOM generation",
	author="Your Company",
	author_email="admin@example.com",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires
)
