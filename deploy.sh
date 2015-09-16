if [[ -z "${CI}" ]] ;
then
    echo "This script can only be run from within the continuous integration environment."
    exit 1
fi

cp ./npmrc ~/.npmrc

if [[ "${TRAVIS_BRANCH}" == "environments/npm" ]] ;
then
    yes '' | npm adduser
    npm publish
    exit 0
fi

echo "Unknown branch: ${TRAVIS_BRANCH}, skipping deployment."
