import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/search', async (req, res) => {
  const { organizationName, description} = req.body;

  try {
    // Step 1 - Search for the organization
    const searchResponse = await axios.post(
      'http://data.orghunter.com/v1/charitysearch',
      null,
      {
        params: {
          user_key: process.env.ORGHUNTER_API_KEY,
          searchTerm: organizationName,
          eligible: 1,
          rows: 5
        },
      }
    );

    const results = searchResponse.data?.data;

    if (!results || results.length === 0) {
       return res.render("results", {
         orgDetails: null,
         grants: [],
         error: `No organization found matching "${organizationName}". Try a different name.`,
       });
    }

    const topOrganization = results[0];
    const topOrganizationEIN = topOrganization.ein;

    // Step 2 - Fetch full organization details
    const basicResponse = await axios.post(
      'https://data.orghunter.com/v1/charitybasic',
      null,
      {
        params: {
          user_key: process.env.ORGHUNTER_API_KEY,
          ein: topOrganizationEIN
        }
      }
    );

    const orgDetails = basicResponse.data?.data;

    if (!orgDetails) {
      return res.render("results", {
        orgDetails: null,
        grants: [],
        error: `Could not recieve organization details. Please try again.`,
      });
    }

    // Step 3 - Build keyword string from organization details
    const keywords = keywordGen(orgDetails, topOrganization, description);

    const grantsResponse = await axios.post(
      `https://api.grants.gov/v1/api/search2`,
      {
        keyword: keywords,
        oppStatuses: 'forecasted|posted',
        eligibilities: `12`,
        fundingInstruments: `G`,
        rows: 10,
        startRecordNum: 0
      }
    );

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const grants = (grantsResponse.data?.data?.oppHits || []).filter(grant => {
      if(!grant.openDate) return true;
      const openDate = new Date(grant.openDate);
      return openDate >= oneYearAgo;
    });

    grants.sort((a, b) => new Date(b.openDate) - new Date(a.openDate));
    grants.forEach(grant => {
      grant.title = decodeEntities(grant.title);
    });

    res.render('results', { orgDetails, grants, error: null });
  } catch (error) {
    console.error('Error occurred while searching for organizations:', error);
    res.status(500).send('Internal Server Error');
  }
});

function keywordGen(org, searchResult, userDescription) {

  // Best case: Use the user's description if given and is not empty
  if(userDescription && userDescription.trim() !== '') {
    return userDescription.trim();
  }

  // Next best: Use the search result's mission statement if available and not empty
  if(searchResult?.missionStatement && searchResult.missionStatement.trim() !== '') {
    return searchResult.missionStatement.trim();
  }

  // Fallback: Use IRS classification data
  const parts = [];
  if (org.nteeClass) parts.push(org.nteeClass);
  if (org.nteeType) parts.push(org.nteeType);
  if (org.activity2) parts.push(org.activity2);

  return parts.join(' ') || 'nonprofit community services';
}

// Grants.gov sends some titles with HTML entities already encoded (e.g. "&ndash;").
// Decode them so EJS escapes the text only once and the real character displays.
function decodeEntities(text) {
  if (!text) return text;
  const entities = {
    '&ndash;': '–',
    '&mdash;': '—',
    '&lsquo;': '‘',
    '&rsquo;': '’',
    '&ldquo;': '“',
    '&rdquo;': '”',
    '&amp;': '&',
  };
  return text.replaceAll(/&\w+;/g, (match) => entities[match] ?? match);
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});